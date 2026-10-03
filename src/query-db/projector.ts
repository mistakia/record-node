// Incremental projection of oplog state into the query index (§4.4.2, §4.5
// step 5, §4.7). The oplog's current-state map is the single resolution of
// each key: the projector never re-sorts entries itself, it writes whatever
// entry the oplog holds as current after an append or a merge.

import type { DatabaseSync } from 'node:sqlite'

import { compute_about_id } from '#entry/id.ts'
import { is_operation, is_put } from '#entry/operations.ts'
import {
  decode_payload,
  validate_about_content,
  validate_log_content,
  validate_track_content
} from '#entry/payload.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { Oplog } from '#oplog/dag.ts'
import type { MergeResult } from '#oplog/merge.ts'
import type { Envelope, ListenPayload } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import { in_transaction } from './schema.ts'

// Reads a content payload block by CID: a ContentStore's get satisfies it.
export type ContentReader = (cid: string) => Promise<Uint8Array | undefined>

type Content = Record<string, unknown>

export interface Projector {
  // After append_entry on the oplog.
  project_append: (input: { oplog: Oplog, entry: VerifiedEntry }) => Promise<void>
  // After merge_entries on the oplog.
  project_merge: (input: { oplog: Oplog, result: MergeResult }) => Promise<void>
  // Re-projects keys from the oplog's current state, e.g. once their content
  // payload reaches the local store.
  project_keys: (input: { oplog: Oplog, keys: Iterable<string> }) => Promise<void>
  // Projects every key and every listen of a library: the rebuild path.
  project_library: (input: { oplog: Oplog }) => Promise<void>
  // Drops every row of a library, for unlink.
  remove_library: (input: { library_address: string }) => Promise<void>
  // The persisted projection marker for one library: the entry heads its rows
  // cover and the keys whose content was missing at the last write, or
  // undefined when the index holds nothing for the library, so a restart
  // rebuilds it by replay (§4.7).
  projection_state: (input: { library_address: string }) => Promise<{ heads: readonly string[], pending: readonly string[] } | undefined>
}

const text = (value: unknown): string | null => typeof value === 'string' ? value : null
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
const record = (value: unknown): Content => is_record(value) ? value : {}

// Single-valued artists come through as a plain string.
const artists_of = (value: unknown): string[] => typeof value === 'string' ? [value] : strings(value)

const KEYED_TABLES = [
  ['tracks', 'track_id'],
  ['tags', 'track_id'],
  ['resolvers', 'track_id'],
  ['logs', 'log_id'],
  ['about', 'about_id']
] as const

const create_statements = (db: DatabaseSync) => ({
  clear_key: KEYED_TABLES.map(([table, column]) =>
    db.prepare(`DELETE FROM ${table} WHERE library_address = ? AND ${column} = ?`)),
  delete_entry: db.prepare('DELETE FROM entries WHERE library_address = ? AND key = ?'),
  upsert_entry: db.prepare(`
    INSERT OR REPLACE INTO entries (library_address, key, entry_hash, op, type, clock_time, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  insert_track: db.prepare(`
    INSERT INTO tracks (
      library_address, track_id, entry_hash, content_cid, audio_cid, audio_size_bytes, title, artist,
      artists, album, album_artist, remixer, genre, bpm, duration_seconds, bitrate, codec, sample_rate,
      lossless, artwork, added_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insert_tag: db.prepare('INSERT OR IGNORE INTO tags (library_address, track_id, tag) VALUES (?, ?, ?)'),
  insert_resolver: db.prepare(`
    INSERT OR IGNORE INTO resolvers (
      library_address, track_id, extractor, id, fulltitle, thumbnail, artist, alt_title, upload_date,
      webpage_url, duration_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insert_log: db.prepare('INSERT INTO logs (library_address, log_id, entry_hash, linked_address, alias) VALUES (?, ?, ?, ?, ?)'),
  insert_about: db.prepare(`
    INSERT INTO about (library_address, about_id, entry_hash, name, bio, location, avatar)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  insert_listen: db.prepare(`
    INSERT OR IGNORE INTO listens (library_address, entry_hash, track_id, address, timestamp)
    VALUES (?, ?, ?, ?, ?)`),
  remove_library: [...KEYED_TABLES.map(([table]) => table), 'entries', 'listens'].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE library_address = ?`)),
  read_marker: db.prepare('SELECT heads, pending FROM library_heads WHERE library_address = ?'),
  upsert_marker: db.prepare(`
    INSERT INTO library_heads (library_address, heads, pending)
    VALUES (?, ?, ?)
    ON CONFLICT(library_address) DO UPDATE SET heads = excluded.heads, pending = excluded.pending`),
  delete_marker: db.prepare('DELETE FROM library_heads WHERE library_address = ?')
})

type Statements = ReturnType<typeof create_statements>

// The canonical marker encoding of an oplog's heads: the sorted hashes, so two
// equal head sets always encode identically.
const heads_of = (oplog: Oplog): string => JSON.stringify([...oplog.heads].sort())

// The pending keys a marker row recorded, as a set for incremental update.
const pending_of = (statements: Statements, library_address: string): Set<string> => {
  const row = statements.read_marker.get(library_address) as { pending?: string } | undefined
  return new Set(row?.pending === undefined ? [] : JSON.parse(row.pending) as string[])
}

// Rewrites the library's marker in the same transaction as the rows just
// written, so a crash leaves the index either fully current or rebuilt by
// replay at the next start, never claiming heads whose rows are missing
// (§4.7). A key whose current entry is a PUT that is not in the store joins
// the pending set; a key whose content arrived leaves it.
const touch_marker = ({ statements, oplog, stable }: {
  statements: Statements
  oplog: Oplog
  stable: readonly { key: string, entry: VerifiedEntry | undefined, content: Content | undefined }[]
}) => {
  const pending = pending_of(statements, oplog.chain.address)
  for (const { key, entry, content } of stable) {
    pending.delete(key)
    if (entry !== undefined && is_put(entry.operation) && content === undefined) pending.add(key)
  }
  statements.upsert_marker.run(oplog.chain.address, heads_of(oplog), JSON.stringify([...pending].sort()))
}

// First sight of a track in this library: the earliest envelope timestamp over
// every known PUT for the key, so a relabel does not move it and a replay
// reproduces it.
const added_at_of = ({ oplog, key }: { oplog: Oplog, key: string }): number => {
  let earliest = Number.POSITIVE_INFINITY
  for (const hash of oplog.key_entries.get(key) ?? []) {
    const operation = oplog.entries.get(hash)?.operation
    if (operation !== undefined && is_put(operation)) earliest = Math.min(earliest, operation.value.timestamp)
  }
  return earliest
}

const write_track = ({ statements, library_address, entry, envelope, content, added_at_ms }: {
  statements: Statements
  library_address: string
  entry: VerifiedEntry
  envelope: Envelope
  content: Content | undefined
  added_at_ms: number
}) => {
  const tags = record(content?.tags)
  const audio = record(content?.audio)
  statements.insert_track.run(
    library_address, envelope.id, entry.hash, envelope.content,
    text(content?.hash), number(content?.size),
    text(tags.title), text(tags.artist), JSON.stringify(artists_of(tags.artists)), text(tags.album),
    text(tags.albumartist), text(tags.remixer), JSON.stringify(strings(tags.genre)), number(tags.bpm),
    number(audio.duration), number(audio.bitrate), text(audio.codec), number(audio.sampleRate),
    typeof audio.lossless === 'boolean' ? Number(audio.lossless) : null,
    JSON.stringify(strings(content?.artwork)), added_at_ms
  )
  for (const tag of envelope.tags ?? []) statements.insert_tag.run(library_address, envelope.id, tag)
  for (const resolver of Array.isArray(content?.resolver) ? content.resolver : []) {
    const { extractor, id, fulltitle, thumbnail, artist, alt_title, upload_date, webpage_url, duration } = record(resolver)
    statements.insert_resolver.run(
      library_address, envelope.id, text(extractor), text(id), text(fulltitle), text(thumbnail), text(artist),
      text(alt_title), text(upload_date), text(webpage_url), number(duration)
    )
  }
}

const write_put = ({ statements, oplog, entry, envelope, content }: {
  statements: Statements
  oplog: Oplog
  entry: VerifiedEntry
  envelope: Envelope
  content: Content | undefined
}) => {
  const library_address = oplog.chain.address
  if (envelope.type === 'track') {
    const added_at_ms = added_at_of({ oplog, key: envelope.id })
    write_track({ statements, library_address, entry, envelope, content, added_at_ms })
  } else if (envelope.type === 'log') {
    statements.insert_log.run(library_address, envelope.id, entry.hash, text(content?.address), text(content?.alias))
  } else if (content !== undefined) {
    const { name, bio, location, avatar } = content
    statements.insert_about.run(library_address, envelope.id, entry.hash, text(name), text(bio), text(location), text(avatar))
  }
}

// Replaces every row a key projects to with the projection of its current entry.
const write_key = ({ statements, oplog, key, entry, content }: {
  statements: Statements
  oplog: Oplog
  key: string
  entry: VerifiedEntry | undefined
  content: Content | undefined
}) => {
  const library_address = oplog.chain.address
  for (const statement of statements.clear_key) statement.run(library_address, key)
  if (entry === undefined || !is_operation(entry.operation)) {
    statements.delete_entry.run(library_address, key)
    return
  }
  const { operation } = entry
  statements.upsert_entry.run(
    library_address, key, entry.hash, operation.op, operation.value.type, entry.entry.clock.time, operation.value.timestamp
  )
  if (is_put(operation)) write_put({ statements, oplog, entry, envelope: operation.value, content })
}

const write_listen = ({ statements, library_address, entry }: {
  statements: Statements
  library_address: string
  entry: VerifiedEntry
}) => {
  const { trackId, address, timestamp } = entry.operation as ListenPayload
  statements.insert_listen.run(library_address, entry.hash, trackId, address, timestamp)
}

// The validated content payload behind a PUT, or undefined when the block is
// not stored or does not validate for its envelope type.
const load_content = async ({ read_content, oplog, entry }: {
  read_content: ContentReader
  oplog: Oplog
  entry: VerifiedEntry | undefined
}): Promise<Content | undefined> => {
  if (entry === undefined || !is_put(entry.operation)) return undefined
  const envelope = entry.operation.value
  const bytes = await read_content(envelope.content)
  if (bytes === undefined) return undefined
  try {
    const value = decode_payload(bytes)
    if (envelope.type === 'track') return validate_track_content(value)
    if (envelope.type === 'log') return validate_log_content(value)
    // A profile for another library never stands in for this one's (§2.6).
    if (envelope.id !== compute_about_id(oplog.chain.address)) return undefined
    return validate_about_content({ value, library_address: oplog.chain.address })
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
}

export const create_projector = ({ db, read_content }: {
  db: DatabaseSync
  read_content: ContentReader
}): Projector => {
  const statements = create_statements(db)

  // Jobs run one at a time in call order, so batches projected concurrently
  // never interleave their writes.
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const run = tail.then(job)
    tail = run.catch(() => {})
    return run
  }

  // Content loads are async, and the oplog can move on while they run. A key
  // whose current entry changed under a load is loaded again, so a write
  // always carries the current entry at write time (§4.5 concurrent merges).
  const write_keys = async ({ oplog, keys }: { oplog: Oplog, keys: Iterable<string> }) => {
    let pending = new Set(keys)
    while (pending.size > 0) {
      const loaded = await Promise.all([...pending].map(async (key) => {
        const entry = oplog.current.get(key)
        return { key, entry, content: await load_content({ read_content, oplog, entry }) }
      }))
      const stable = loaded.filter(({ key, entry }) => oplog.current.get(key) === entry)
      in_transaction(db, () => {
        for (const { key, entry, content } of stable) write_key({ statements, oplog, key, entry, content })
        touch_marker({ statements, oplog, stable })
      })
      pending = new Set(loaded.filter((item) => !stable.includes(item)).map(({ key }) => key))
    }
  }

  const write_listens = (oplog: Oplog, entries: Iterable<VerifiedEntry>) => in_transaction(db, () => {
    for (const entry of entries) write_listen({ statements, library_address: oplog.chain.address, entry })
    statements.upsert_marker.run(oplog.chain.address, heads_of(oplog), '[]')
  })

  const project_entries = ({ oplog, entries }: { oplog: Oplog, entries: readonly VerifiedEntry[] }) =>
    enqueue(async () => {
      if (oplog.chain.type === 'listens') {
        write_listens(oplog, entries)
        return
      }
      const keys = entries.flatMap(({ operation }) => is_operation(operation) ? [operation.key] : [])
      await write_keys({ oplog, keys })
    })

  return {
    project_append: ({ oplog, entry }) => project_entries({ oplog, entries: [entry] }),
    project_merge: ({ oplog, result }) => project_entries({ oplog, entries: result.merged }),
    project_keys: ({ oplog, keys }) => enqueue(() => write_keys({ oplog, keys })),
    project_library: ({ oplog }) => enqueue(async () => {
      if (oplog.chain.type === 'listens') write_listens(oplog, oplog.entries.values())
      else await write_keys({ oplog, keys: oplog.key_entries.keys() })
    }),
    remove_library: ({ library_address }) => enqueue(async () => {
      in_transaction(db, () => {
        for (const statement of statements.remove_library) statement.run(library_address)
        statements.delete_marker.run(library_address)
      })
    }),
    projection_state: async ({ library_address }) => {
      const row = statements.read_marker.get(library_address) as { heads: string, pending: string } | undefined
      if (row === undefined) return undefined
      return { heads: JSON.parse(row.heads) as string[], pending: JSON.parse(row.pending) as string[] }
    }
  }
}
