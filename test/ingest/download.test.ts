// The §6.4.2 download: every hop, the first and each redirect, must reach a
// public address. The servers listen on loopback, so the tests reach them
// under *.test names that a test lookup maps to 127.0.0.1; every other name
// goes through the real guarded lookup.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LookupFunction } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guarded_lookup } from 'record-resolver'

import { create_download, download_to_file } from '#ingest/download.ts'

const AUDIO = 'not really audio'

const test_lookup: LookupFunction = (hostname, options, callback) => {
  if (!hostname.endsWith('.test')) {
    guarded_lookup(hostname, options, callback)
    return
  }
  if (options.all === true) callback(null, [{ address: '127.0.0.1', family: 4 }])
  else callback(null, '127.0.0.1', 4)
}
const download = create_download({ lookup: test_lookup })

const seen_headers: Array<Record<string, string>> = []
let media: ReturnType<typeof Bun.serve>
let other: ReturnType<typeof Bun.serve>

beforeAll(() => {
  other = Bun.serve({
    port: 0,
    fetch: (request) => {
      seen_headers.push(Object.fromEntries(request.headers))
      return new Response(AUDIO)
    }
  })
  media = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname, searchParams } = new URL(request.url)
      const to = searchParams.get('to')
      if (pathname === '/audio') return new Response(AUDIO)
      if (pathname === '/gone') return new Response('gone', { status: 410 })
      if (pathname === '/loop') return Response.redirect('/loop', 302)
      if (pathname === '/redirect' && to !== null) return Response.redirect(to, 302)
      return new Response('not found', { status: 404 })
    }
  })
})

afterAll(async () => {
  await media.stop(true)
  await other.stop(true)
})

const output_path = (): string => join(mkdtempSync(join(tmpdir(), 'record-download-test-')), 'a.m4a')
const media_url = (path: string): string => `http://media.test:${media.port}${path}`
const redirect_to = (to: string): string => media_url(`/redirect?to=${encodeURIComponent(to)}`)

describe('download_to_file', () => {
  test('streams a public url to the file', async () => {
    const path = output_path()
    await download({ url: media_url('/audio'), output_path: path })
    expect(readFileSync(path, 'utf8')).toBe(AUDIO)
  })

  test('follows a redirect, dropping credentials when the origin changes', async () => {
    const path = output_path()
    seen_headers.length = 0
    await download({
      url: redirect_to(`http://other.test:${other.port}/audio`),
      headers: { Authorization: 'Bearer secret', Cookie: 'session=1', 'User-Agent': 'yt-dlp' },
      output_path: path
    })
    expect(readFileSync(path, 'utf8')).toBe(AUDIO)
    expect(seen_headers).toHaveLength(1)
    expect(seen_headers[0]).toMatchObject({ 'user-agent': 'yt-dlp' })
    expect(seen_headers[0]).not.toHaveProperty('authorization')
    expect(seen_headers[0]).not.toHaveProperty('cookie')
  })

  test('refuses a first hop to a loopback literal or a name resolving to loopback', async () => {
    await expect(download_to_file({ url: `http://127.0.0.1:${media.port}/audio`, output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('loopback') })
    await expect(download_to_file({ url: `http://localhost:${media.port}/audio`, output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('loopback') })
  })

  test('refuses a redirect hop to a non-public address', async () => {
    for (const to of [
      `http://127.0.0.1:${media.port}/audio`,
      `http://localhost:${media.port}/audio`,
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:10.0.0.1]/',
      'http://100.64.0.1/'
    ]) {
      const path = output_path()
      await expect(download({ url: redirect_to(to), output_path: path })).rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('refused') })
      expect(existsSync(path)).toBe(false)
    }
  })

  test('refuses a redirect to a non-http(s) url', async () => {
    await expect(download({ url: redirect_to('file:///etc/passwd'), output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('non-http(s)') })
  })

  test('stops after ten redirects', async () => {
    await expect(download({ url: media_url('/loop'), output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('more than 10') })
  })

  test('a refused or broken download is download_failed', async () => {
    await expect(download({ url: media_url('/gone'), output_path: output_path() })).rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('410') })
    await expect(download({ url: 'http://closed.test:1/a.m4a', output_path: output_path() })).rejects.toMatchObject({ code: 'download_failed' })
  })
})

// A media host that cuts each response after `cut` bytes, as YouTube's cut a
// long stream, and answers a Range request with 206 unless told not to.
describe('download_to_file resumes a cut response', () => {
  const BODY = Buffer.from(Array.from({ length: 5000 }, (_, index) => index % 251))
  const requests: Array<string | undefined> = []
  let server: Server
  let port = 0

  beforeAll(async () => {
    server = createServer((request, response) => {
      const { pathname, searchParams } = new URL(request.url ?? '/', 'http://media.test')
      const cut = Number(searchParams.get('cut'))
      requests.push(request.headers.range)
      const start = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? '')?.[1] ?? 0)
      const ranged = start > 0 && pathname !== '/no-range'
      const body = ranged ? BODY.subarray(start) : BODY
      response.writeHead(ranged ? 206 : 200, {
        'Content-Length': body.length,
        ...(ranged ? { 'Content-Range': `bytes ${start}-${BODY.length - 1}/${BODY.length}` } : {})
      })
      const always = pathname === '/always-cut'
      if (body.length <= cut || (!always && start > 0 && pathname !== '/no-range')) {
        response.end(body)
        return
      }
      // The pause lets the client write what it received before the cut.
      response.write(body.subarray(0, cut), () => { setTimeout(() => response.socket?.destroy(), 50) })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const url = (path: string): string => `http://media.test:${port}${path}`

  test('a cut response resumes at the byte the file ends on', async () => {
    const path = output_path()
    requests.length = 0
    await download({ url: url('/flaky?cut=1200'), output_path: path })
    expect(readFileSync(path).equals(BODY)).toBe(true)
    expect(requests[0]).toBeUndefined()
    expect(requests.slice(1).every((range) => /^bytes=\d+-$/.test(range ?? ''))).toBe(true)
  })

  test('a source that ignores Range fails rather than corrupt the file', async () => {
    await expect(download({ url: url('/no-range?cut=1200'), output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('did not resume') })
  })

  test('a source that keeps cutting gives up after the resume limit', async () => {
    requests.length = 0
    await expect(download({ url: url('/always-cut?cut=100'), output_path: output_path() }))
      .rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('broke off') })
    expect(requests).toHaveLength(9)
  })
})
