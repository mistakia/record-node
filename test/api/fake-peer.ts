// An in-memory ApiPeer for the API tests: canned, spec-shaped state, every
// call recorded, and events emitted on demand.

import { randomUUID } from 'node:crypto'

import { ac_chain_vector, audio_pipeline_vector } from '#test/conformance/vectors.ts'
import {
  PeerError,
  type About,
  type ApiPeer,
  type Capability,
  type Library,
  type ReplicationPolicy,
  type PeerEvent,
  type Resolver,
  type Track
} from '#types/peer.ts'

export const OWN_ADDRESS = ac_chain_vector.library_address
export const LINKED_ADDRESS = '/record/zdpuAxgMzJaTqK1HQU6CKQ9p2vUaG4eR9zUk4HwYj9Q1pK7DC/library'
export const UNKNOWN_ADDRESS = '/record/zdpuAxgMzJaTqK1HQU6CKQ9p2vUaG4eR9zUk4HwYj9Q1pK7DC/unknown'
export const TRACK_ID = audio_pipeline_vector.track_id
export const AUDIO_CID = audio_pipeline_vector.audio_cid
export const CONTENT_CID = 'zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc'
export const PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
export const META_LOG_ADDRESS = '/record/zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx/identity'
export const CAPABILITY_ID = 'zBwWX61Hk9TaWwav3Kd5fTzdx4TEyJTU4NzSjhqDqDjyz9UoQPm7poFUmfJMQxUQU6VCbbF53C9MJbQW8HZGdwiNSb1Y1'

export const make_track = (overrides: Partial<Track> = {}): Track => ({
  id: TRACK_ID,
  content_cid: CONTENT_CID,
  audio_cid: AUDIO_CID,
  audio_size_bytes: 1024,
  title: 'Sine Sweep',
  artist: null,
  artists: [],
  genre: [],
  artwork: [],
  resolvers: [{ extractor: 'youtube', id: 'abc123', fulltitle: 'Sine Sweep', duration: 5 }],
  tags: [{ library_address: OWN_ADDRESS, tag: 'test' }],
  listen_count: 0,
  have_track: true,
  is_pinned: false,
  added_at_ms: 1611272666695,
  ...overrides
})

const make_library = (address: string, overrides: Partial<Library> = {}): Library => ({
  id: address.length.toString(16).padStart(64, '0'),
  address,
  library_type: 'recordstore',
  name: null,
  alias: null,
  track_count: 1,
  linked_library_count: 0,
  length: 1,
  heads: [CONTENT_CID],
  replication_status: { progress: 1, total: 1 },
  is_replicating: false,
  connected: true,
  is_loading_index: false,
  is_processing_index: false,
  is_linked: false,
  is_own: false,
  is_retired: false,
  held_capability_ids: [],
  replication_mode: null,
  peer_ids: [],
  ...overrides
})

export const make_capability = (overrides: Partial<Capability> = {}): Capability => ({
  capability_id: CAPABILITY_ID,
  library_address: LINKED_ADDRESS,
  issuer: PUBLIC_KEY,
  via_capability_id: null,
  grantee: { type: 'key', key: PUBLIC_KEY },
  actions: ['library.append_track'],
  filter: null,
  conditions: [],
  issued_at_ms: 1700000000000,
  expires_at_ms: null,
  status: 'active',
  revoked_by: null,
  ...overrides
})

export interface FakePeer extends ApiPeer {
  calls: Array<{ method: string, args: unknown[] }>
  audio: Map<string, Uint8Array>
  emit: (event: PeerEvent) => void
  listener_count: () => number
}

export const create_fake_peer = (): FakePeer => {
  const calls: FakePeer['calls'] = []
  const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }) }
  const handlers = new Set<(event: PeerEvent) => void>()
  const audio = new Map<string, Uint8Array>()
  const libraries = new Map<string, Library>([
    [OWN_ADDRESS, make_library(OWN_ADDRESS, { is_own: true, name: 'mine', replication_mode: 'full' })],
    [LINKED_ADDRESS, make_library(LINKED_ADDRESS, { is_linked: true, alias: 'friend', replication_mode: 'full' })]
  ])
  const policies = new Map<string, ReplicationPolicy>([[LINKED_ADDRESS, { mode: 'full', filter: null, connected: true }]])
  const capabilities: Capability[] = [make_capability()]
  const abouts = new Map<string, About>([[OWN_ADDRESS, { library_address: OWN_ADDRESS, name: 'mine', bio: null }]])
  let track = make_track()

  const known_track = (track_id: string): Track => {
    if (track_id !== track.id) throw new PeerError('not_found', `unknown track: ${track_id}`)
    return track
  }

  return {
    calls,
    audio,
    emit: (event) => { for (const handler of handlers) handler(event) },
    listener_count: () => handlers.size,

    list_tracks: async (query) => {
      record('list_tracks', query)
      return { items: [track].slice(query.offset, query.offset + query.limit), total: 1 }
    },
    add_track: async (input) => {
      record('add_track', input)
      if (input.content_cid !== CONTENT_CID) throw new PeerError('not_found', `content not found: ${input.content_cid}`)
      return track
    },
    update_track: async (input) => {
      record('update_track', input)
      const current = known_track(input.track_id)
      const title = input.tags.title
      track = { ...current, ...(typeof title === 'string' ? { title } : {}) }
      return track
    },
    remove_track: async (input) => {
      record('remove_track', input)
      known_track(input.track_id)
    },
    pin_track: async (cid) => {
      record('pin_track', cid)
      track = { ...track, is_pinned: true }
    },
    unpin_track: async (cid) => {
      record('unpin_track', cid)
      if (!track.is_pinned) throw new PeerError('not_found', `not pinned: ${cid}`)
      track = { ...track, is_pinned: false }
    },

    list_tags: async (filter) => {
      record('list_tags', filter)
      return [{ tag: 'test', count: 1 }]
    },
    add_tag: async ({ track_id, tag, ...target }) => {
      record('add_tag', { track_id, tag, ...target })
      const current = known_track(track_id)
      if (current.tags.some((label) => label.tag === tag)) throw new PeerError('conflict', `already tagged: ${tag}`)
      track = { ...current, tags: [...current.tags, { library_address: OWN_ADDRESS, tag }] }
      return track
    },
    remove_tag: async ({ track_id, tag, ...target }) => {
      record('remove_tag', { track_id, tag, ...target })
      const current = known_track(track_id)
      track = { ...current, tags: current.tags.filter((label) => label.tag !== tag) }
      return track
    },

    list_libraries: async () => [...libraries.values()],
    get_library: async (address) => libraries.get(address),
    link_library: async ({ address, alias }) => {
      record('link_library', { address, alias })
      const library = make_library(address, { is_linked: true, alias })
      libraries.set(address, library)
      return library
    },
    unlink_library: async (address) => { record('unlink_library', address) },
    connect_library: async (address) => { record('connect_library', address) },
    disconnect_library: async (address) => { record('disconnect_library', address) },
    get_replication_policy: async (address) => {
      const policy = policies.get(address)
      if (policy === undefined) throw new PeerError('not_found', `not linked: ${address}`)
      return policy
    },
    set_replication_policy: async ({ address, mode, filter }) => {
      record('set_replication_policy', { address, mode, filter })
      if (address === OWN_ADDRESS) throw new PeerError('conflict', 'own libraries are full')
      const policy = { mode, filter: mode === 'selective' ? filter as ReplicationPolicy['filter'] : null, connected: true }
      policies.set(address, policy)
      return policy
    },
    list_capabilities: async (address) => capabilities.filter(({ library_address }) => library_address === address),
    issue_capability: async (input) => {
      record('issue_capability', input)
      return make_capability({ library_address: input.library_address, actions: input.actions })
    },
    revoke_capability: async (input) => {
      record('revoke_capability', input)
      if (!capabilities.some(({ capability_id }) => capability_id === input.capability_id)) throw new PeerError('not_found', 'unknown capability')
    },
    get_about: async (address) => abouts.get(address),
    set_about: async ({ address, fields, capability_id }) => {
      record('set_about', { address, fields, capability_id })
      if (address !== OWN_ADDRESS && capability_id === undefined) throw new PeerError('forbidden', `not the owner of ${address}`)
      const about = { ...abouts.get(address), ...fields, library_address: address }
      abouts.set(address, about)
      return about
    },

    list_listens: async (page) => {
      record('list_listens', page)
      return { items: [make_track({ listen_count: 2, listen_timestamps_ms: [1, 2] })], total: 1 }
    },
    record_listen: async (listen) => {
      record('record_listen', listen)
      return { track_id: listen.track_id, count: 1, timestamps_ms: [Date.now()] }
    },

    list_peers: async () => [{ peer_id: '12D3KooWfake', multiaddrs: ['/ip4/127.0.0.1/tcp/4001'] }],
    get_settings: async () => ({ peer_id: '12D3KooWfake', version: '1.0.0-alpha.0', bandwidth: { total_in_bytes: '0' } }),
    get_identity: async () => ({ public_key: PUBLIC_KEY, meta_log_address: META_LOG_ADDRESS, own_library_address: OWN_ADDRESS }),
    export_identity: async () => ({ public_key: '08021221', private_key: '08021220' }),
    import_identity: async (key) => {
      record('import_identity', key)
      return { id: TRACK_ID, public_key: '08021221', own_library_address: OWN_ADDRESS, meta_log_address: META_LOG_ADDRESS }
    },
    list_own_libraries: async () => [...libraries.values()].filter(({ is_own }) => is_own),
    create_own_library: async (input) => {
      record('create_own_library', input)
      const address = OWN_ADDRESS.replace(/library$/, input.discriminator ?? 'library-1')
      if (libraries.has(address)) throw new PeerError('conflict', `already recorded: ${address}`)
      const library = make_library(address, { is_own: true, replication_mode: 'full' })
      libraries.set(address, library)
      return library
    },
    retire_own_library: async (address) => {
      record('retire_own_library', address)
      const library = libraries.get(address)
      if (library?.is_own !== true) throw new PeerError('not_found', `not own: ${address}`)
      libraries.set(address, { ...library, is_retired: true })
    },
    list_held_capabilities: async () => capabilities,
    read_meta_log: async (query) => {
      record('read_meta_log', query)
      return {
        address: META_LOG_ADDRESS,
        heads: [CONTENT_CID],
        items: [{
          entry_hash: CONTENT_CID,
          op: 'PUT',
          type: 'library',
          key: TRACK_ID,
          record: { type: 'library', v: 1, timestamp: 1700000000000, address: OWN_ADDRESS },
          clock_time: 1,
          timestamp_ms: 1700000000000,
          is_current: true
        }],
        total: 1
      }
    },

    get_audio: async (cid) => audio.get(cid),
    has_audio: async (cid) => audio.has(cid),

    import_files: async (input) => {
      record('import_files', input)
      return { import_id: randomUUID(), file_count: input.paths.length }
    },
    import_url: async (input) => {
      record('import_url', input)
      return { import_id: randomUUID() }
    },

    subscribe: (handler) => {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    }
  }
}

// A resolver answering from a fixed URL-to-records table.
export const create_fake_resolver = (records: Record<string, Array<Record<string, unknown>>>): Resolver =>
  async (url) => records[url] ?? []
