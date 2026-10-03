// Each route domain end to end over HTTP against the fake peer, with every
// response validated against 7-http-api.yaml.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { CONTENT_CID, LINKED_ADDRESS, OWN_ADDRESS, TRACK_ID, UNKNOWN_ADDRESS } from './fake-peer.ts'
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

  test('DELETE /tracks/{id} removes, 404s unknown, and rejects a malformed id', async () => {
    expect((await fetch(api.url(`/tracks/${TRACK_ID}`), { method: 'DELETE' })).status).toBe(204)
    await expect_error(await fetch(api.url(`/tracks/${'0'.repeat(64)}`), { method: 'DELETE' }), 404, 'NOT_FOUND')
    await expect_error(await fetch(api.url('/tracks/not-hex'), { method: 'DELETE' }), 400, 'VALIDATION_ERROR')
  })
})

describe('api: tags', () => {
  test('GET /tags lists counts', async () => {
    const response = await fetch(api.url('/tags'))
    expect(await response.json()).toEqual([{ tag: 'test', count: 1 }])
  })

  test('POST /tags attaches, and a repeat is a 409', async () => {
    const response = await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'downtempo' })
    expect(response.status).toBe(200)
    expect((await response.json() as { tags: Array<{ tag: string }> }).tags.map(({ tag }) => tag)).toContain('downtempo')
    await expect_error(await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'downtempo' }), 409, 'CONFLICT')
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

  test('GET /libraries/{address}/about returns the profile', async () => {
    const response = await fetch(api.url(`${library_path(OWN_ADDRESS)}/about`))
    expect(await response.json()).toEqual({ library_address: OWN_ADDRESS, name: 'mine', bio: null })
  })

  test('POST /libraries/{address}/about updates only supplied fields and stamps the address', async () => {
    const response = await post_json(api.url(`${library_path(OWN_ADDRESS)}/about`), { bio: 'hello', location: null })
    expect(response.status).toBe(200)
    expect(last_call('set_about')).toEqual([{ address: OWN_ADDRESS, fields: { bio: 'hello', location: null } }])
    expect((await response.json() as { library_address: string }).library_address).toBe(OWN_ADDRESS)
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
