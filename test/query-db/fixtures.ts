// Query-database fixtures: content payloads stored beside the oplog, a
// projector wired to them, and a table dump for row-level comparison.

import type { DatabaseSync } from 'node:sqlite'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { build_about_envelope, build_log_envelope } from '#entry/envelope.ts'
import { compute_about_id, compute_log_id } from '#entry/id.ts'
import { build_del_operation, build_put_operation } from '#entry/operations.ts'
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

export const add_track = async ({ oplog, key_pair, block_store, timestamp, tags, store = true, ...content }: {
  oplog: Oplog
  key_pair: KeyPair
  block_store: BlockStore
  timestamp?: number
  tags?: readonly string[]
  store?: boolean
} & Parameters<typeof track_content>[0]) => {
  const value = track_content(content)
  if (store) await store_content({ block_store, value })
  return append_track({
    oplog,
    key_pair,
    fingerprint: content.fingerprint,
    content: value,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(tags === undefined ? {} : { tags })
  })
}

export const delete_track = ({ oplog, key_pair, key, timestamp }: {
  oplog: Oplog
  key_pair: KeyPair
  key: string
  timestamp?: number
}) => append_entry({
  oplog,
  key_pair,
  payload: build_del_operation({ key, type: 'track', ...(timestamp === undefined ? {} : { timestamp }) })
})

export const add_link = async ({ oplog, key_pair, block_store, address, alias = null }: {
  oplog: Oplog
  key_pair: KeyPair
  block_store: BlockStore
  address: string
  alias?: string | null
}) => {
  const content_cid = await store_content({ block_store, value: { address, alias } })
  return append_entry({
    oplog,
    key_pair,
    payload: build_put_operation({ envelope: build_log_envelope({ id: compute_log_id(address), content_cid }) })
  })
}

export const set_about = async ({ oplog, key_pair, block_store, profile }: {
  oplog: Oplog
  key_pair: KeyPair
  block_store: BlockStore
  profile: Record<string, string>
}) => {
  const address = oplog.chain.address
  const content_cid = await store_content({ block_store, value: { address, ...profile } })
  return append_entry({
    oplog,
    key_pair,
    payload: build_put_operation({ envelope: build_about_envelope({ id: compute_about_id(address), content_cid }) })
  })
}

// Resolves each read after a random delay, so concurrent projection jobs
// finish their content loads out of order.
export const jittered_reader = (block_store: BlockStore): ContentReader => async (cid) => {
  await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)))
  return block_store.get(cid)
}

// Every row of every table in a stable order.
export const dump_query_db = (db: DatabaseSync) => Object.fromEntries(QUERY_TABLES.map((table) => {
  const rows = db.prepare(`SELECT * FROM ${table}`).all().map((row) => JSON.stringify(Object.entries(row)))
  return [table, rows.sort()]
}))

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
