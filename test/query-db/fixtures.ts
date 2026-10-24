// Query-database fixtures: content payloads stored beside the oplog, a
// projector wired to them, and a table dump for row-level comparison.

import type { DatabaseSync } from 'node:sqlite'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_about_put, build_del_operation, build_labels_put } from '#entry/operations.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { append_entry, type Oplog } from '#oplog/dag.ts'
import type { ContentReader } from '#query-db/projector.ts'
import { QUERY_TABLES } from '#query-db/schema.ts'
import type { BlockStore } from '#types/library.ts'
import { append_track, content_cid_of } from '#test/helpers/library.ts'

export const store_content = async ({ block_store, value }: { block_store: BlockStore, value: unknown }): Promise<string> => {
  const cid = content_cid_of(value)
  await block_store.put(cid, encode_canonical(value))
  return cid
}

// A §2.4.1 content object. dag-cbor has no undefined, so absent tags are left out.
export const track_content = ({ fingerprint, audio = {}, resolver = [], ...tags }: {
  fingerprint: string
  title?: string
  artist?: string
  artists?: string[]
  album?: string
  albumartist?: string
  remixer?: string
  bpm?: number
  genre?: string[]
  audio?: Record<string, unknown>
  resolver?: Record<string, unknown>[]
}) => ({
  hash: content_cid_of({ audio: fingerprint }),
  size: 4096,
  tags: { acoustid_fingerprint: fingerprint, ...tags },
  audio: { codec: 'MPEG 1 Layer 3', lossless: false, ...audio },
  artwork: [content_cid_of({ artwork: fingerprint })],
  resolver
})

// The track PUT. Labels are a separate label record (add_labels).
export const add_track = async ({ oplog, key_pair, block_store, timestamp, store = true, ...content }: {
  oplog: Oplog
  key_pair: KeyPair
  block_store: BlockStore
  timestamp?: number
  store?: boolean
} & Parameters<typeof track_content>[0]) => {
  const value = track_content(content)
  if (store) await store_content({ block_store, value })
  return append_track({ oplog, key_pair, fingerprint: content.fingerprint, content: value, ...(timestamp === undefined ? {} : { timestamp }) })
}

// The track id a fixture fingerprint derives.
export const track_id_of = (fingerprint: string): string => compute_track_id(fingerprint)

export const add_labels = ({ oplog, key_pair, track_id, set = [], unset = [], timestamp }: {
  oplog: Oplog
  key_pair: KeyPair
  track_id: string
  set?: readonly string[]
  unset?: readonly string[]
  timestamp?: number
}) => append_entry({
  oplog,
  key_pair,
  payload: build_labels_put({
    set: set.map((label) => [track_id, label] as const),
    unset: unset.map((label) => [track_id, label] as const),
    ...(timestamp === undefined ? {} : { timestamp })
  })
})

export const delete_track = ({ oplog, key_pair, key, timestamp }: {
  oplog: Oplog
  key_pair: KeyPair
  key: string
  timestamp?: number
}) => append_entry({
  oplog,
  key_pair,
  payload: build_del_operation({ key, ...(timestamp === undefined ? {} : { timestamp }) })
})

export const set_about = ({ oplog, key_pair, name, timestamp }: {
  oplog: Oplog
  key_pair: KeyPair
  name: string
  timestamp?: number
}) => append_entry({ oplog, key_pair, payload: build_about_put({ name, ...(timestamp === undefined ? {} : { timestamp }) }) })

// Resolves each read after a random delay, so concurrent projection jobs
// finish their content loads out of order.
export const jittered_reader = (block_store: BlockStore): ContentReader => async (cid) => {
  await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)))
  return block_store.get(cid)
}

// Every row of every table in a stable order.
const dump_rows = (db: DatabaseSync, sql: string): string[] =>
  db.prepare(sql).all().map((row) => JSON.stringify(Object.entries(row))).sort()

// Every projection table, and the search index by track rather than by its
// insertion-ordered rowids.
export const dump_query_db = (db: DatabaseSync) => ({
  ...Object.fromEntries(QUERY_TABLES.map((table) => [table, dump_rows(db, `SELECT * FROM ${table}`)])),
  track_search: dump_rows(db, `
    SELECT k.library_address, k.track_id, s.title, s.artist, s.album, s.remixer
    FROM track_search AS s JOIN track_search_keys AS k ON k.id = s.rowid`)
})

// Fisher-Yates over a seeded generator, so a failing order reproduces.
export const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const result = [...items]
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    const swap = result[index] as T
    result[index] = result[other] as T
    result[other] = swap
  }
  return result
}

export const in_batches = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
