// An in-memory ApiPeer for the API tests: canned, spec-shaped state, every
// call recorded, and events emitted on demand.

import { randomUUID } from 'node:crypto'

import { ac_chain_vector, audio_pipeline_vector } from '#test/conformance/vectors.ts'
import {
  PeerError,
  type About,
  type ApiPeer,
  type Library,
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
  added_at_ms: 1611272666695,
  ...overrides
})

const make_library = (address: string, overrides: Partial<Library> = {}): Library => ({
  id: address.length.toString(16).padStart(64, '0'),
  address,
  name: null,
  alias: null,
  track_count: 1,
  linked_library_count: 0,
  length: 1,
  replication_status: { progress: 1, total: 1 },
  is_replicating: false,
  is_loading_index: false,
  is_processing_index: false,
  is_linked: false,
  is_own: false,
  peer_ids: [],
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
    [OWN_ADDRESS, make_library(OWN_ADDRESS, { is_own: true, name: 'mine' })],
    [LINKED_ADDRESS, make_library(LINKED_ADDRESS, { is_linked: true, alias: 'friend' })]
  ])
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
    add_track: async (content_cid) => {
      record('add_track', content_cid)
      if (content_cid !== CONTENT_CID) throw new PeerError('not_found', `content not found: ${content_cid}`)
      return track
    },
    remove_track: async (track_id) => {
      record('remove_track', track_id)
      known_track(track_id)
    },

    list_tags: async (filter) => {
      record('list_tags', filter)
      return [{ tag: 'test', count: 1 }]
    },
    add_tag: async ({ track_id, tag }) => {
      record('add_tag', { track_id, tag })
      const current = known_track(track_id)
      if (current.tags.some((label) => label.tag === tag)) throw new PeerError('conflict', `already tagged: ${tag}`)
      track = { ...current, tags: [...current.tags, { library_address: OWN_ADDRESS, tag }] }
      return track
    },
    remove_tag: async ({ track_id, tag }) => {
      record('remove_tag', { track_id, tag })
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
    get_about: async (address) => abouts.get(address),
    set_about: async ({ address, fields }) => {
      record('set_about', { address, fields })
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
    export_identity: async () => ({ public_key: '08021221', private_key: '08021220' }),
    import_identity: async (key) => {
      record('import_identity', key)
      return { id: TRACK_ID, public_key: '08021221', own_library_address: OWN_ADDRESS }
    },

    get_audio: async (cid) => audio.get(cid),
    has_audio: async (cid) => audio.has(cid),

    import_files: async (paths) => {
      record('import_files', paths)
      return { import_id: randomUUID(), file_count: paths.length }
    },
    import_url: async (url) => {
      record('import_url', url)
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
