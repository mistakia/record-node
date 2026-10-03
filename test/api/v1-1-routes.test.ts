// The routes chapter 7 v1.1.0 adds, end to end over HTTP against the fake
// peer, with every response validated against 7-http-api.yaml: the identity
// and its libraries, capabilities, replication policy, pins, and write
// targets on every write.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { PeerError } from '#types/peer.ts'
import { CAPABILITY_ID, CONTENT_CID, LINKED_ADDRESS, META_LOG_ADDRESS, OWN_ADDRESS, PUBLIC_KEY, TRACK_ID } from './fake-peer.ts'
import { library_path, post_json, start_test_server, type TestServer } from './server.ts'

let api: TestServer

beforeAll(async () => { api = await start_test_server() })
afterAll(async () => { await api.stop() })

const last_call = (method: string) => api.peer.calls.filter((call) => call.method === method).at(-1)?.args

const request = async (path: string, init: { method: string, body?: unknown }): Promise<Response> =>
  await fetch(api.url(path), {
    method: init.method,
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) })
  })

const error_code = async (response: Response): Promise<string> => ((await response.json()) as { error: { code: string } }).error.code

describe('api v1.1: identity', () => {
  test('GET /identity names the key, the identity library, and the default own library', async () => {
    const response = await fetch(api.url('/identity'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ public_key: PUBLIC_KEY, meta_log_address: META_LOG_ADDRESS, own_library_address: OWN_ADDRESS })
  })

  test('GET, POST, and DELETE /identity/libraries list, create, and retire own libraries', async () => {
    expect((await (await fetch(api.url('/identity/libraries'))).json() as unknown[]).length).toBe(1)
    const created = await post_json(api.url('/identity/libraries'), { discriminator: 'mixes', about: { name: 'Mixes' } })
    expect(created.status).toBe(201)
    expect(last_call('create_own_library')).toEqual([{ discriminator: 'mixes', about: { name: 'Mixes' } }])
    const { address } = await created.json() as { address: string }
    expect(await error_code(await post_json(api.url('/identity/libraries'), { discriminator: 'mixes' }))).toBe('CONFLICT')
    expect((await post_json(api.url('/identity/libraries'), { discriminator: 'bad name' })).status).toBe(400)
    expect((await request(`/identity/libraries/${encodeURIComponent(address)}`, { method: 'DELETE' })).status).toBe(204)
    expect(last_call('retire_own_library')).toEqual([address])
    expect(await error_code(await request(`/identity/libraries/${encodeURIComponent(LINKED_ADDRESS)}`, { method: 'DELETE' }))).toBe('NOT_FOUND')
  })

  test('GET /identity/capabilities and GET /identity/meta-log', async () => {
    expect(await (await fetch(api.url('/identity/capabilities'))).json()).toEqual([expect.objectContaining({ capability_id: CAPABILITY_ID })])
    const page = await fetch(api.url('/identity/meta-log?type=library&current_only=true&limit=5'))
    expect(page.status).toBe(200)
    expect(last_call('read_meta_log')).toEqual([{ offset: 0, limit: 5, type: 'library', current_only: true }])
    expect((await fetch(api.url('/identity/meta-log?type=listen'))).status).toBe(400)
  })
})

describe('api v1.1: capabilities and policy', () => {
  test('GET, POST, and DELETE /libraries/{address}/capabilities list, issue, and revoke', async () => {
    const path = `${library_path(LINKED_ADDRESS)}/capabilities`
    expect(await (await fetch(api.url(path))).json()).toEqual([expect.objectContaining({ capability_id: CAPABILITY_ID, status: 'active' })])
    const body = { grantee: { type: 'key', key: PUBLIC_KEY }, actions: ['library.append_track'], capability_id: CAPABILITY_ID }
    const issued = await post_json(api.url(path), body)
    expect(issued.status).toBe(201)
    expect(last_call('issue_capability')).toEqual([{ library_address: LINKED_ADDRESS, ...body }])
    expect((await post_json(api.url(path), { grantee: { type: 'key', key: PUBLIC_KEY }, actions: [] })).status).toBe(400)
    const revoked = await request(`${path}/${encodeURIComponent(CAPABILITY_ID)}?capability_id=${encodeURIComponent(CAPABILITY_ID)}`, { method: 'DELETE' })
    expect(revoked.status).toBe(204)
    expect(last_call('revoke_capability')).toEqual([{ library_address: LINKED_ADDRESS, capability_id: CAPABILITY_ID, via_capability_id: CAPABILITY_ID }])
  })

  test('GET and PUT /libraries/{address}/replication-policy', async () => {
    const path = `${library_path(LINKED_ADDRESS)}/replication-policy`
    expect(await (await fetch(api.url(path))).json()).toEqual({ mode: 'full', filter: null, connected: true })
    const filter = { type: 'match', fields: { tags: 'keep' } }
    const put = await request(path, { method: 'PUT', body: { mode: 'selective', filter } })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ mode: 'selective', filter, connected: true })
    expect((await request(path, { method: 'PUT', body: { mode: 'everything' } })).status).toBe(400)
    expect(await error_code(await request(`${library_path(OWN_ADDRESS)}/replication-policy`, { method: 'PUT', body: { mode: 'index_only' } }))).toBe('CONFLICT')
  })

  test('a capability refusal is a 403 with the capability code', async () => {
    const original = api.peer.add_tag
    try {
      for (const [code, expected] of [['capability_revoked', 'CAPABILITY_REVOKED'], ['capability_expired', 'CAPABILITY_EXPIRED'], ['forbidden', 'FORBIDDEN']] as const) {
        api.peer.add_tag = async () => { throw new PeerError(code, 'refused') }
        const response = await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'x', library_address: LINKED_ADDRESS, capability_id: CAPABILITY_ID })
        expect(response.status).toBe(403)
        expect(await error_code(response)).toBe(expected)
      }
    } finally {
      api.peer.add_tag = original
    }
  })
})

describe('api v1.1: write targets and pins', () => {
  test('every write passes its library_address and capability_id through', async () => {
    const target = { library_address: LINKED_ADDRESS, capability_id: CAPABILITY_ID }
    expect((await post_json(api.url('/tracks'), { content_cid: CONTENT_CID, ...target })).status).toBe(200)
    expect(last_call('add_track')).toEqual([{ content_cid: CONTENT_CID, ...target }])
    expect((await post_json(api.url('/tags'), { track_id: TRACK_ID, tag: 'shared', ...target })).status).toBe(200)
    expect(last_call('add_tag')).toEqual([{ track_id: TRACK_ID, tag: 'shared', ...target }])
    const query = new URLSearchParams({ track_id: TRACK_ID, tag: 'shared', ...target })
    expect((await request(`/tags?${query.toString()}`, { method: 'DELETE' })).status).toBe(200)
    expect(last_call('remove_tag')).toEqual([{ track_id: TRACK_ID, tag: 'shared', ...target }])
    expect((await request(`/tracks/${TRACK_ID}?library_address=${encodeURIComponent(OWN_ADDRESS)}`, { method: 'DELETE' })).status).toBe(204)
    expect(last_call('remove_track')).toEqual([{ track_id: TRACK_ID, library_address: OWN_ADDRESS }])
    expect((await post_json(api.url(`${library_path(LINKED_ADDRESS)}/about`), { name: 'shared', capability_id: CAPABILITY_ID })).status).toBe(200)
    expect(last_call('set_about')).toEqual([{ address: LINKED_ADDRESS, fields: { name: 'shared' }, capability_id: CAPABILITY_ID }])
    expect((await post_json(api.url('/import/url'), { url: 'https://example.test/a', ...target })).status).toBe(202)
    expect(last_call('import_url')).toEqual([{ url: 'https://example.test/a', ...target }])
  })

  test('POST and DELETE /tracks/{cid}/pin pin and unpin, and an unpinned CID is a 404', async () => {
    const path = `/tracks/${CONTENT_CID}/pin`
    expect((await request(path, { method: 'POST' })).status).toBe(204)
    expect(last_call('pin_track')).toEqual([CONTENT_CID])
    expect((await request(path, { method: 'DELETE' })).status).toBe(204)
    expect(await error_code(await request(path, { method: 'DELETE' }))).toBe('NOT_FOUND')
  })
})
