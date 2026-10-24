// Each route domain end to end over HTTP against the fake peer, with every
// response validated against 7-http-api.yaml.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ResolverError } from 'record-resolver'

import { create_token_authenticator, issue_access_token } from '#api/access-tokens.ts'
import { CENSUS_ROW, CONTENT_CID, LINKED_ADDRESS, OWN_ADDRESS, TRACK_ID, UNKNOWN_ADDRESS } from './fake-peer.ts'
import { library_path, post_json, start_test_server, type TestServer } from './server.ts'

let api: TestServer

beforeAll(async () => { api = await start_test_server() })
afterAll(async () => { await api.stop() })

const last_call = (method: string) => api.peer.calls.filter((call) => call.method === method).at(-1)?.args

const expect_error = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  const body = await response.json() as { error: { code: string, message: string, details?: unknown[] } }
  expect(body.error.code).toBe(code)
  expect(typeof body.error.message).toBe('string')
  return body
}

describe('api: tracks', () => {
  test('GET /tracks applies the spec defaults and passes filters through', async () => {
    const response = await fetch(api.url(`/tracks?tags=a&tags=b&library_addresses=${encodeURIComponent(OWN_ADDRESS)}&query=sine`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache, must-revalidate')
    expect((await response.json() as { total: number }).total).toBe(1)
    expect(last_call('list_tracks')).toEqual([{
      offset: 0, limit: 100, tags: ['a', 'b'], library_addresses: [OWN_ADDRESS], query: 'sine', shuffle: false, sort: 'added_at', order: 'desc'
    }])
    // label_libraries is passed apart from membership, once or many times.
    expect((await fetch(api.url(`/tracks?label_libraries=${encodeURIComponent(LINKED_ADDRESS)}`))).status).toBe(200)
    expect(last_call('list_tracks')).toEqual([expect.objectContaining({ label_libraries: [LINKED_ADDRESS] })])
    expect(last_call('list_tracks')?.[0]).not.toHaveProperty('library_addresses')
  })

  test('GET /tracks takes label groups as JSON and rejects a malformed or empty group', async () => {
    const groups = [['genre/house', 'genre/techno, deep'], ['era/2010s']]
    expect((await fetch(api.url(`/tracks?tag_groups=${encodeURIComponent(JSON.stringify(groups))}`))).status).toBe(200)
    expect(last_call('list_tracks')).toEqual([expect.objectContaining({ tag_groups: groups })])
    for (const value of ['genre/house', JSON.stringify([[]]), JSON.stringify(['genre/house'])]) {
      await expect_error(await fetch(api.url(`/tracks?tag_groups=${encodeURIComponent(value)}`)), 400, 'VALIDATION_ERROR')
    }
  })

  test('GET /tracks sorts by bitrate', async () => {
    expect((await fetch(api.url('/tracks?sort=bitrate&order=asc'))).status).toBe(200)
    expect(last_call('list_tracks')).toEqual([expect.objectContaining({ sort: 'bitrate', order: 'asc' })])
  })

  test('GET /tracks rejects a limit above 500 and an unlisted sort', async () => {
    await expect_error(await fetch(api.url('/tracks?limit=501')), 400, 'VALIDATION_ERROR')
    const body = await expect_error(await fetch(api.url('/tracks?sort=rowid')), 400, 'VALIDATION_ERROR')
    expect(body.error.details?.length).toBeGreaterThan(0)
  })

  test('POST /tracks adopts by content CID, and 404s unknown content', async () => {
    const response = await post_json(api.url('/tracks'), { content_cid: CONTENT_CID })
    expect(response.status).toBe(200)
    expect((await response.json() as { id: string }).id).toBe(TRACK_ID)
    await expect_error(await post_json(api.url('/tracks'), { content_cid: 'zdpuUnknown' }), 404, 'NOT_FOUND')
    await expect_error(await post_json(api.url('/tracks'), {}), 400, 'VALIDATION_ERROR')
  })

  test('POST /tracks passes labels for the adopted entry', async () => {
    expect((await post_json(api.url('/tracks'), { content_cid: CONTENT_CID, tags: ['tier/personal'] })).status).toBe(200)
    expect(last_call('add_track')).toEqual([expect.objectContaining({ content_cid: CONTENT_CID, tags: ['tier/personal'] })])
    await expect_error(await post_json(api.url('/tracks'), { content_cid: CONTENT_CID, tags: [''] }), 400, 'VALIDATION_ERROR')
  })

  test('DELETE /tracks/{id} removes, 404s unknown, and rejects a malformed id', async () => {
    expect((await fetch(api.url(`/tracks/${TRACK_ID}`), { method: 'DELETE' })).status).toBe(204)
    await expect_error(await fetch(api.url(`/tracks/${'0'.repeat(64)}`), { method: 'DELETE' }), 404, 'NOT_FOUND')
    await expect_error(await fetch(api.url('/tracks/not-hex'), { method: 'DELETE' }), 400, 'VALIDATION_ERROR')
  })
})

describe('api: tags', () => {
  test('GET /tags lists counts', async () => {
    const response = await fetch(api.url('/tags'))
    expect(await response.json()).toEqual([{ tag: 'test', count: 1, managed: false }])
  })

  test('GET /tags passes a prefix and label_libraries', async () => {
    expect((await fetch(api.url('/tags?prefix=view%2F'))).status).toBe(200)
    expect(last_call('list_tags')).toEqual([{ prefix: 'view/', managed_libraries: [] }])
    const both = new URLSearchParams([['label_libraries', OWN_ADDRESS], ['label_libraries', LINKED_ADDRESS]])
    expect((await fetch(api.url(`/tags?${both.toString()}`))).status).toBe(200)
    expect(last_call('list_tags')).toEqual([{ label_libraries: [OWN_ADDRESS, LINKED_ADDRESS], managed_libraries: [] }])
    await expect_error(await fetch(api.url('/tags?prefix=')), 400, 'VALIDATION_ERROR')
  })

  test('PATCH /tracks/{id}/tags hands the label change to the peer and returns the track', async () => {
    const patch = async (body: unknown) => await fetch(api.url(`/tracks/${TRACK_ID}/tags`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const response = await patch({ add: ['view/a'], remove: ['view/b'], library_address: OWN_ADDRESS })
    expect(response.status).toBe(200)
    expect((await response.json() as { tags: Array<{ tag: string }> }).tags.map(({ tag }) => tag)).toContain('view/a')
    expect(last_call('change_labels')).toEqual([expect.objectContaining({ track_id: TRACK_ID, add: ['view/a'], remove: ['view/b'], library_address: OWN_ADDRESS })])
    await expect_error(await patch({ set: [''] }), 400, 'VALIDATION_ERROR')
  })

  test('POST /tags/batch answers a result per item, held or not, and bounds the batch', async () => {
    const response = await post_json(api.url('/tags/batch'), { items: [{ track_id: TRACK_ID, add: ['view/a'] }, { track_id: '0'.repeat(64), add: ['view/a'] }] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [
        { track_id: TRACK_ID, status: 'updated', tags: expect.any(Array) },
        { track_id: '0'.repeat(64), status: 'updated', tags: ['view/a'] }
      ]
    })
    await expect_error(await post_json(api.url('/tags/batch'), { items: [] }), 400, 'VALIDATION_ERROR')
    await expect_error(await post_json(api.url('/tags/batch'), { items: Array.from({ length: 201 }, () => ({ track_id: TRACK_ID, add: ['x'] })) }), 400, 'VALIDATION_ERROR')
    await expect_error(await post_json(api.url('/tags/batch'), { items: [{ track_id: 'not-hex', add: ['x'] }] }), 400, 'VALIDATION_ERROR')
  })

  test('POST /tags sets a label, a repeat is safe, and an unheld track answers its labels', async () => {
    const response = await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'downtempo' })
    expect(response.status).toBe(200)
    expect((await response.json() as { tags: Array<{ tag: string }> }).tags.map(({ tag }) => tag)).toContain('downtempo')
    expect((await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'downtempo' })).status).toBe(200)
    const unheld = await post_json(api.url('/tags'), { track_id: 'a'.repeat(64), tag: 'downtempo' })
    expect(await unheld.json()).toEqual({ track_id: 'a'.repeat(64), tags: ['downtempo'] })
    await expect_error(await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: '' }), 400, 'VALIDATION_ERROR')
  })

  test('DELETE /tags detaches by query', async () => {
    const response = await fetch(api.url(`/tags?track_id=${TRACK_ID}&tag=downtempo`), { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(last_call('remove_tag')).toEqual([{ track_id: TRACK_ID, tag: 'downtempo' }])
    await expect_error(await fetch(api.url(`/tags?track_id=${TRACK_ID}`), { method: 'DELETE' }), 400, 'VALIDATION_ERROR')
  })
})

describe('api: libraries', () => {
  test('GET /libraries and GET /libraries/{address} with an encoded address', async () => {
    expect(((await (await fetch(api.url('/libraries'))).json()) as unknown[]).length).toBe(2)
    const response = await fetch(api.url(library_path(OWN_ADDRESS)))
    expect(response.status).toBe(200)
    expect((await response.json() as { is_own: boolean }).is_own).toBe(true)
    await expect_error(await fetch(api.url(library_path(UNKNOWN_ADDRESS))), 404, 'NOT_FOUND')
  })

  test('POST /libraries links, and linking a linked library is a 409', async () => {
    const response = await post_json(api.url('/libraries'), { library_address: UNKNOWN_ADDRESS, alias: null })
    expect(response.status).toBe(200)
    expect(last_call('link_library')).toEqual([{ address: UNKNOWN_ADDRESS, alias: null }])
    await expect_error(await post_json(api.url('/libraries'), { library_address: LINKED_ADDRESS }), 409, 'CONFLICT')
  })

  test('DELETE, connect, and disconnect act on known libraries and 404 unknown ones', async () => {
    expect((await fetch(api.url(library_path(LINKED_ADDRESS)), { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(api.url(`${library_path(LINKED_ADDRESS)}/connect`), { method: 'POST' })).status).toBe(202)
    expect((await fetch(api.url(`${library_path(LINKED_ADDRESS)}/disconnect`), { method: 'POST' })).status).toBe(202)
    expect(last_call('disconnect_library')).toEqual([LINKED_ADDRESS])
    const unknown = `/record/zdpuAxgMzJaTqK1HQU6CKQ9p2vUaG4eR9zUk4HwYj9Q1pK7DC/${'never'}`
    await expect_error(await fetch(api.url(`${library_path(unknown)}/connect`), { method: 'POST' }), 404, 'NOT_FOUND')
  })

  test('GET /libraries/{address}/about returns the name', async () => {
    const response = await fetch(api.url(`${library_path(OWN_ADDRESS)}/about`))
    expect(await response.json()).toEqual({ library_address: OWN_ADDRESS, name: 'mine' })
  })

  test('POST /libraries/{address}/about renames, and takes a name only', async () => {
    const response = await post_json(api.url(`${library_path(OWN_ADDRESS)}/about`), { name: 'Mixes' })
    expect(response.status).toBe(200)
    expect(last_call('set_about')).toEqual([{ address: OWN_ADDRESS, name: 'Mixes' }])
    expect(await response.json()).toEqual({ library_address: OWN_ADDRESS, name: 'Mixes' })
    for (const body of [{}, { name: '' }, { name: 7 }]) {
      await expect_error(await post_json(api.url(`${library_path(OWN_ADDRESS)}/about`), body), 400, 'VALIDATION_ERROR')
    }
  })

  test('GET /libraries/{address}/labels pages the library label state, and 404s an unknown library', async () => {
    const response = await fetch(api.url(`${library_path(OWN_ADDRESS)}/labels?limit=5`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ library_address: OWN_ADDRESS, items: [{ track_id: TRACK_ID, tags: expect.any(Array) }], total: 1 })
    expect(last_call('list_library_labels')).toEqual([{ address: OWN_ADDRESS, offset: 0, limit: 5 }])
    await expect_error(await fetch(api.url(`${library_path(UNKNOWN_ADDRESS.replace(/unknown$/, 'unlisted'))}/labels`)), 404, 'NOT_FOUND')
  })

  test('GET /libraries/{address}/profile answers the owner profile, or 404 when none is known', async () => {
    const response = await fetch(api.url(`${library_path(OWN_ADDRESS)}/profile`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ public_key: expect.any(String) }))
    await expect_error(await fetch(api.url(`${library_path(LINKED_ADDRESS)}/profile`)), 404, 'NOT_FOUND')
  })

  test('POST /libraries/{address}/about is a 403 for a library the caller does not own', async () => {
    const response = await post_json(api.url(`${library_path(LINKED_ADDRESS)}/about`), { name: 'hijack' })
    await expect_error(response, 403, 'FORBIDDEN')
    expect((await fetch(api.url(`${library_path(LINKED_ADDRESS)}/about`))).status).toBe(404)
  })
})

describe('api: listens, peers, settings, identity', () => {
  test('GET /listens pages, POST /listens records', async () => {
    expect((await fetch(api.url('/listens?offset=5&limit=10'))).status).toBe(200)
    expect(last_call('list_listens')).toEqual([{ offset: 5, limit: 10 }])
    const response = await post_json(api.url('/listens'), { track_id: TRACK_ID, library_address: OWN_ADDRESS })
    expect((await response.json() as { count: number }).count).toBe(1)
    await expect_error(await post_json(api.url('/listens'), { library_address: OWN_ADDRESS }), 400, 'VALIDATION_ERROR')
  })

  test('GET /peers and GET /settings', async () => {
    expect(((await (await fetch(api.url('/peers'))).json()) as unknown[]).length).toBe(1)
    expect((await (await fetch(api.url('/settings'))).json() as { peer_id: string }).peer_id).toBe('12D3KooWfake')
  })

  test('GET /identity/export and POST /identity/import with and without a key', async () => {
    expect((await fetch(api.url('/identity/export'))).status).toBe(200)
    expect((await post_json(api.url('/identity/import'), { private_key: '08021220' })).status).toBe(200)
    expect(last_call('import_identity')).toEqual([{ private_key: '08021220' }])
    expect((await fetch(api.url('/identity/import'), { method: 'POST' })).status).toBe(200)
    expect(last_call('import_identity')).toEqual([{}])
  })

  test('GET and PUT /identity/profile read and replace the whole profile', async () => {
    expect(await (await fetch(api.url('/identity/profile'))).json()).toEqual({ public_key: expect.any(String), name: null, bio: null, avatar: null })
    const put = async (body: unknown) => await fetch(api.url('/identity/profile'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const response = await put({ name: 'Ada', bio: 'listens a lot' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ name: 'Ada', bio: 'listens a lot', avatar: null }))
    expect(last_call('set_profile')).toEqual([{ name: 'Ada', bio: 'listens a lot' }])
    for (const body of [{ name: '' }, { bio: 'x'.repeat(1025) }, { avatar: 7 }]) await expect_error(await put(body), 400, 'VALIDATION_ERROR')
  })

  test('POST /identity/libraries takes a name and no discriminator', async () => {
    const response = await post_json(api.url('/identity/libraries'), { name: 'Mixes' })
    expect(response.status).toBe(201)
    expect(last_call('create_own_library')).toEqual([{ name: 'Mixes' }])
    for (const body of [{}, { name: '' }]) {
      await expect_error(await post_json(api.url('/identity/libraries'), body), 400, 'VALIDATION_ERROR')
    }
  })
})

describe('api: track metadata', () => {
  test('PATCH /tracks/{id} hands the tag changes to the peer and returns the track', async () => {
    const response = await fetch(api.url(`/tracks/${TRACK_ID}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: { title: 'Corrected', artist: null } })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: TRACK_ID, title: 'Corrected' })
    expect(last_call('update_track')).toEqual([{ track_id: TRACK_ID, tags: { title: 'Corrected', artist: null } }])
    for (const body of [{}, { tags: {} }, { tags: 'title' }]) {
      const refused = await fetch(api.url(`/tracks/${TRACK_ID}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      await expect_error(refused, 400, 'VALIDATION_ERROR')
    }
  })
})

describe('api: audio re-derivation', () => {
  test('POST /tracks/{id}/rederive hands the track and write target to the peer and returns the track', async () => {
    const response = await fetch(api.url(`/tracks/${TRACK_ID}/rederive`), { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: TRACK_ID })
    expect(last_call('rederive_track')).toEqual([{ track_id: TRACK_ID }])
    const refused = await fetch(api.url(`/tracks/${TRACK_ID}/rederive`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ library_address: 7 }) })
    await expect_error(refused, 400, 'VALIDATION_ERROR')
  })
})

describe('api: import', () => {
  test('POST /import/url hands the URL to the ingest pipeline and acks 202', async () => {
    const response = await post_json(api.url('/import/url'), { url: 'https://www.youtube.com/watch?v=abc123' })
    expect(response.status).toBe(202)
    expect(typeof (await response.json() as { import_id: string }).import_id).toBe('string')
    expect(last_call('import_url')).toEqual([{ url: 'https://www.youtube.com/watch?v=abc123' }])
    await expect_error(await post_json(api.url('/import/url'), { url: 'not a url' }), 400, 'VALIDATION_ERROR')
  })
})

describe('api: resolve', () => {
  test('GET /resolve 400s a URL with no source and a value that is not a URL', async () => {
    const no_source = await fetch(api.url(`/resolve?url=${encodeURIComponent('https://example.test/empty')}`))
    await expect_error(no_source, 400, 'VALIDATION_ERROR')
    await expect_error(await fetch(api.url('/resolve?url=nope')), 400, 'VALIDATION_ERROR')
    await expect_error(await fetch(api.url('/resolve')), 400, 'VALIDATION_ERROR')
  })

  test('a resolver failure on /resolve and /import/url is 502 RESOLVER_FAILED with the resolver code', async () => {
    const failure = new ResolverError({ code: 'YTDLP_FAILED', message: 'yt-dlp exited 1: ERROR: Requested format is not available' })
    const failing = await start_test_server({ resolve: async () => { throw failure } })
    failing.peer.import_url = async () => { throw failure }
    try {
      for (const response of [
        await fetch(failing.url(`/resolve?url=${encodeURIComponent('https://www.youtube.com/watch?v=abc123')}`)),
        await post_json(failing.url('/import/url'), { url: 'https://www.youtube.com/watch?v=abc123' })
      ]) {
        const body = await expect_error(response, 502, 'RESOLVER_FAILED')
        expect(body.error).toMatchObject({ resolver_code: 'YTDLP_FAILED', message: failure.message })
      }
    } finally {
      await failing.stop()
    }
  })
})

describe('api: server', () => {
  test('an unknown /api path is a 404 envelope', async () => {
    await expect_error(await fetch(api.url('/nope')), 404, 'NOT_FOUND')
  })

  test('the docs serve the vendored yaml as JSON and as swagger-ui', async () => {
    const spec = await (await fetch(api.url('/docs/openapi.json'))).json() as { openapi: string, info: { version: string } }
    expect(spec.openapi).toBe('3.1.0')
    const page = await fetch(api.url('/docs/'))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('swagger-ui')
  })

  test('a peer response that breaks the contract fails response validation', async () => {
    const original = api.peer.get_settings
    api.peer.get_settings = async () => ({}) as never
    try {
      await expect_error(await fetch(api.url('/settings')), 500, 'INTERNAL_ERROR')
    } finally {
      api.peer.get_settings = original
    }
  })
})

describe('api: origin allowlist', () => {
  test('with no allowlist configured, the known-client default refuses every browser origin', async () => {
    expect((await fetch(api.url('/settings'))).status).toBe(200)
    await expect_error(await fetch(api.url('/settings'), { headers: { origin: 'http://localhost:8080' } }), 403, 'FORBIDDEN')
    await expect_error(await fetch(api.url('/settings'), { method: 'OPTIONS', headers: { origin: 'null' } }), 403, 'FORBIDDEN')
  })

  test('a listed origin is echoed and answered on preflight, and null never is', async () => {
    const open = await start_test_server({ cors_origins: ['http://localhost:8080', 'null'] })
    try {
      const response = await fetch(open.url('/settings'), { method: 'OPTIONS', headers: { origin: 'http://localhost:8080' } })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8080')
      await expect_error(await fetch(open.url('/settings'), { headers: { origin: 'null' } }), 403, 'FORBIDDEN')
    } finally {
      await open.stop()
    }
  })

  test('an empty allowlist refuses every browser origin, preflight-free uploads included, and serves requests with no Origin', async () => {
    const locked = await start_test_server({ cors_origins: [] })
    try {
      expect((await fetch(locked.url('/settings'))).status).toBe(200)
      await expect_error(await fetch(locked.url('/settings'), { headers: { origin: 'http://localhost:8080' } }), 403, 'FORBIDDEN')
      const form = new FormData()
      form.append('files', new Blob([new Uint8Array(4)]), 'a.flac')
      await expect_error(await fetch(locked.url('/import/file'), { method: 'POST', body: form, headers: { origin: 'https://evil.example' } }), 403, 'FORBIDDEN')
    } finally {
      await locked.stop()
    }
  })
})

describe('api: hosted mode', () => {
  test('a bearer-token verifier gates HTTP requests and a CORS allowlist gates origins', async () => {
    const hosted = await start_test_server({ authenticate: (token) => token === 'good', cors_origins: ['https://app.example'] })
    try {
      await expect_error(await fetch(hosted.url('/settings')), 401, 'UNAUTHORIZED')
      await expect_error(await fetch(hosted.url('/settings'), { headers: { authorization: 'Bearer good', origin: 'https://evil.example' } }), 403, 'FORBIDDEN')
      const allowed = await fetch(hosted.url('/settings'), { headers: { authorization: 'Bearer good', origin: 'https://app.example' } })
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example')
    } finally {
      await hosted.stop()
    }
  })
})

describe('api: node-managed label libraries', () => {
  let dir: string
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'record-managed-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  test('only the managed library\'s token writes its labels; a tokenless loopback write is refused', async () => {
    const path = join(dir, 'access-tokens.json')
    const facets = await issue_access_token({ path, label: 'exporter' })
    const other = await issue_access_token({ path, label: 'phone' })
    const tokens = create_token_authenticator({ path })
    const managed = await start_test_server({ identify: tokens.identify, managed_label_libraries: new Map([[OWN_ADDRESS, facets.entry.id]]) })
    const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
    const label = (headers: Record<string, string> = { 'content-type': 'application/json' }) =>
      fetch(managed.url('/tags'), { method: 'POST', headers, body: JSON.stringify({ track_id: TRACK_ID, tag: 'facet/genre/house', library_address: OWN_ADDRESS }) })
    try {
      await expect_error(await label(), 403, 'FORBIDDEN')
      await expect_error(await label(bearer(other.token)), 403, 'FORBIDDEN')
      await expect_error(await label(bearer('not-a-token')), 401, 'UNAUTHORIZED')
      expect(managed.peer.calls.filter(({ method }) => method === 'add_tag')).toEqual([])
      expect((await label(bearer(facets.token))).status).toBe(200)
      expect(managed.peer.calls.filter(({ method }) => method === 'add_tag').length).toBe(1)
      // Every label write route is guarded, and the guard reads only the target.
      const batch = { items: [{ track_id: TRACK_ID, add: ['x'] }], library_address: OWN_ADDRESS }
      await expect_error(await post_json(managed.url('/tags/batch'), batch), 403, 'FORBIDDEN')
      await expect_error(await fetch(managed.url(`/tags?track_id=${TRACK_ID}&tag=x&library_address=${encodeURIComponent(OWN_ADDRESS)}`), { method: 'DELETE' }), 403, 'FORBIDDEN')
      await expect_error(await fetch(managed.url(`/tracks/${TRACK_ID}/tags`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ add: ['x'], library_address: OWN_ADDRESS }) }), 403, 'FORBIDDEN')
      await expect_error(await post_json(managed.url('/tracks'), { content_cid: CONTENT_CID, tags: ['x'], library_address: OWN_ADDRESS }), 403, 'FORBIDDEN')
      expect((await post_json(managed.url('/tracks'), { content_cid: CONTENT_CID, library_address: OWN_ADDRESS })).status).toBe(200)
      expect((await post_json(managed.url('/tags'), { track_id: TRACK_ID, tag: 'mine' })).status).toBe(200)
      expect((await post_json(managed.url('/tags'), { track_id: TRACK_ID, tag: 'mine', library_address: LINKED_ADDRESS })).status).toBe(200)
      // Reads stay tokenless, and mark the managed library's labels.
      expect(await (await fetch(managed.url('/tags'))).json()).toEqual([{ tag: 'test', count: 1, managed: true }])
    } finally {
      await managed.stop()
    }
  })
})

describe('api: network census (implementation-only)', () => {
  test('GET /network-census returns the day\'s row, 404 without one, 400 on a bad date', async () => {
    const response = await fetch(api.url(`/network-census?date=${CENSUS_ROW.date}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(CENSUS_ROW)
    await expect_error(await fetch(api.url('/network-census?date=2026-10-11')), 404, 'NOT_FOUND')
    await expect_error(await fetch(api.url('/network-census')), 404, 'NOT_FOUND')
    await expect_error(await fetch(api.url('/network-census?date=yesterday')), 400, 'VALIDATION_ERROR')
  })
})
