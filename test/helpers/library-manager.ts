// A library manager over the in-memory content store and query index, with
// helpers to write tracks whose content and audio blob are really stored.

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { create_ac_chain } from '#access-control/create.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_put_operation } from '#entry/operations.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { create_library_manager, type LibraryManager } from '#peer/library.ts'
import { create_memory_state_store } from '#peer/state.ts'
import { create_projector } from '#query-db/projector.ts'
import { open_query_db } from '#query-db/schema.ts'

export const open_library_manager = () => {
  const content_store = create_memory_content_store()
  const db = open_query_db()
  const manager = create_library_manager({
    content_store,
    projector: create_projector({ db, read_content: content_store.get }),
    state_store: create_memory_state_store()
  })
  return { content_store, db, manager }
}

// The chain is written to the store but not opened, so nothing is pinned yet.
export const write_chain = async ({ content_store, name, writer }: { content_store: ContentStore, name: string, writer: KeyPair }) =>
  await create_ac_chain({ name, type: 'recordstore', write_keys: [writer.public_key], block_store: content_store })

// Stores an audio blob and its track content, and returns the PUT payload.
export const stored_track = async ({ content_store, fingerprint, audio }: {
  content_store: ContentStore
  fingerprint: string
  audio: string
}) => {
  const audio_cid = await content_store.import_blob(new TextEncoder().encode(audio))
  const bytes = encode_canonical({ hash: audio_cid, size: audio.length, tags: { acoustid_fingerprint: fingerprint }, audio: {}, artwork: [], resolver: [] })
  const content_cid = compute_cid_string(bytes)
  await content_store.put(content_cid, bytes)
  const payload = build_put_operation({ envelope: build_track_envelope({ id: compute_track_id(fingerprint), content_cid }) })
  return { audio_cid, content_cid, payload }
}

export const append_stored_track = async ({ manager, content_store, library_address, key_pair, fingerprint, audio }: {
  manager: LibraryManager
  content_store: ContentStore
  library_address: string
  key_pair: KeyPair
  fingerprint: string
  audio: string
}) => {
  const track = await stored_track({ content_store, fingerprint, audio })
  const entry = await manager.append({ library_address, payload: track.payload, key_pair })
  return { ...track, entry_hash: entry.hash }
}

export const pinned = async (content_store: ContentStore, cids: readonly string[]): Promise<boolean[]> =>
  await Promise.all(cids.map(async (cid) => await content_store.is_pinned(cid)))
