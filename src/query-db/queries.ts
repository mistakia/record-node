// Read side of the query index, shaped for the HTTP API routes (spec
// 7-http-api.yaml): track lists, tags, listen history, linked libraries,
// and profiles. Field names follow the API Track schema.

import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite'

import { compute_about_id } from '#entry/id.ts'

export const TRACK_SORTS = ['title', 'artist', 'album', 'bpm', 'duration', 'added_at'] as const
export type TrackSort = typeof TRACK_SORTS[number]
export type SortOrder = 'asc' | 'desc'

const SORT_COLUMNS: Record<TrackSort, string> = {
  title: 'title COLLATE NOCASE',
  artist: 'artist COLLATE NOCASE',
  album: 'album COLLATE NOCASE',
  bpm: 'bpm',
  duration: 'duration_seconds',
  added_at: 'added_at_ms'
}

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

export interface TrackTag {
  readonly library_address: string
  readonly tag: string
}

export interface TrackResolver {
  readonly extractor: string
  readonly id: string
  readonly fulltitle?: string
  readonly thumbnail?: string
  readonly artist?: string
  readonly alt_title?: string
  readonly upload_date?: string
  readonly webpage_url?: string
  readonly duration_seconds?: number
}

// One track as the API returns it. Content columns are null while the
// content payload is not in the local store.
export interface TrackRow {
  readonly id: string
  // The library this row's content and resolvers come from: the requestor's
  // own library when it holds the track, else the first address in order.
  readonly library_address: string
  readonly content_cid: string
  readonly audio_cid: string | null
  readonly audio_size_bytes: number | null
  readonly title: string | null
  readonly artist: string | null
  readonly artists: string[]
  readonly album: string | null
  readonly album_artist: string | null
  readonly remixer: string | null
  readonly genre: string[]
  readonly bpm: number | null
  readonly duration_seconds: number | null
  readonly bitrate: number | null
  readonly codec: string | null
  readonly sample_rate: number | null
  readonly lossless: boolean | null
  readonly artwork: string[]
  readonly resolvers: TrackResolver[]
  readonly tags: TrackTag[]
  readonly listen_count: number
  readonly listen_timestamps_ms?: number[]
  readonly have_track: boolean
  readonly added_at_ms: number
}

export interface Page<T> {
  readonly items: T[]
  // The unpaginated match count.
  readonly total: number
}

export interface TagCount {
  readonly tag: string
  readonly count: number
}

export interface ListenCount {
  readonly track_id: string
  readonly count: number
  readonly timestamps_ms: number[]
}

export interface ListenHistoryItem extends ListenCount {
  readonly last_listened_at_ms: number
  // Absent when no indexed library holds the track.
  readonly track?: TrackRow
}

export interface LinkedLibrary {
  readonly address: string
  readonly alias: string | null
}

export interface LibrarySummary {
  readonly track_count: number
  readonly linked_library_count: number
  // Live entries: keys whose current entry is a PUT.
  readonly length: number
}

export interface About {
  readonly library_address: string
  readonly name: string | null
  readonly bio: string | null
  readonly location: string | null
  readonly avatar: string | null
}

export interface ListTracksInput {
  readonly own_library_address?: string | undefined
  readonly library_addresses?: readonly string[] | undefined
  // AND semantics: a track matches when it carries every tag.
  readonly tags?: readonly string[] | undefined
  // Substring match across title, artist, album, and remixer.
  readonly query?: string | undefined
  // Random order, overriding sort.
  readonly shuffle?: boolean | undefined
  readonly sort?: TrackSort | undefined
  readonly order?: SortOrder | undefined
  readonly offset?: number | undefined
  readonly limit?: number | undefined
}

type Row = Record<string, SQLOutputValue>

const assert_page = ({ offset, limit }: { offset: number, limit: number }) => {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError(`offset must be an integer >= 0, not ${offset}`)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_LIMIT}, not ${limit}`)
  }
}

const like_pattern = (query: string): string => `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`

const json_strings = (value: unknown): string[] => JSON.parse(String(value)) as string[]
const nullable_number = (value: unknown): number | null => value === null || value === undefined ? null : Number(value)
const nullable_text = (value: unknown): string | null => value === null || value === undefined ? null : String(value)

const group_by = <T>(rows: readonly Row[], key: string, map: (row: Row) => T): Map<string, T[]> => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(String(row[key])) ?? []
    groups.set(String(row[key]), [...group, map(row)])
  }
  return groups
}

const to_resolver = (row: Row): TrackResolver => {
  const optional = ['fulltitle', 'thumbnail', 'artist', 'alt_title', 'upload_date', 'webpage_url', 'duration_seconds']
    .filter((field) => row[field] !== null)
    .map((field) => [field, row[field]])
  return { extractor: String(row.extractor), id: String(row.id), ...Object.fromEntries(optional) }
}

// One representative row per track id across the scoped libraries: the
// requestor's own library first, then the lowest address.
const scoped_tracks_sql = ({ scoped }: { scoped: boolean }) => `
  SELECT * FROM (
    SELECT tracks.*, row_number() OVER (
      PARTITION BY track_id
      ORDER BY library_address = :own_library_address DESC, library_address ASC
    ) AS representative
    FROM tracks
    ${scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
  ) WHERE representative = 1`

// Tags, resolvers, listen counts, and ownership for a page of track rows.
const hydrate_tracks = ({ db, rows, own_library_address, library_addresses, with_timestamps = false }: {
  db: DatabaseSync
  rows: readonly Row[]
  own_library_address: string
  library_addresses: readonly string[] | undefined
  with_timestamps?: boolean
}): TrackRow[] => {
  const track_ids = JSON.stringify(rows.map((row) => row.track_id))
  const scoped = library_addresses !== undefined
  const tag_rows = db.prepare(`
    SELECT track_id, library_address, tag FROM tags
    WHERE track_id IN (SELECT value FROM json_each(:track_ids))
    ${scoped ? 'AND library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
    ORDER BY track_id, library_address, tag`
  ).all({ track_ids, ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) }) as Row[]
  const tags = group_by(tag_rows, 'track_id', (row) => ({ library_address: String(row.library_address), tag: String(row.tag) }))
  const resolver_rows = db.prepare(`
    SELECT * FROM resolvers
    WHERE (library_address, track_id) IN (SELECT value ->> 0, value ->> 1 FROM json_each(:keys))
    ORDER BY extractor, id`
  ).all({ keys: JSON.stringify(rows.map((row) => [row.library_address, row.track_id])) }) as Row[]
  const resolvers = group_by(resolver_rows, 'track_id', to_resolver)
  const listen_rows = db.prepare(`
    SELECT track_id, timestamp FROM listens
    WHERE track_id IN (SELECT value FROM json_each(:track_ids))
    ORDER BY timestamp DESC, entry_hash`
  ).all({ track_ids }) as Row[]
  const listens = group_by(listen_rows, 'track_id', (row) => Number(row.timestamp))
  const owned = new Set((db.prepare(`
    SELECT track_id FROM tracks
    WHERE library_address = :own_library_address AND track_id IN (SELECT value FROM json_each(:track_ids))`
  ).all({ own_library_address, track_ids }) as Row[]).map((row) => String(row.track_id)))

  return rows.map((row) => {
    const id = String(row.track_id)
    const timestamps = listens.get(id) ?? []
    return {
      id,
      library_address: String(row.library_address),
      content_cid: String(row.content_cid),
      audio_cid: nullable_text(row.audio_cid),
      audio_size_bytes: nullable_number(row.audio_size_bytes),
      title: nullable_text(row.title),
      artist: nullable_text(row.artist),
      artists: json_strings(row.artists),
      album: nullable_text(row.album),
      album_artist: nullable_text(row.album_artist),
      remixer: nullable_text(row.remixer),
      genre: json_strings(row.genre),
      bpm: nullable_number(row.bpm),
      duration_seconds: nullable_number(row.duration_seconds),
      bitrate: nullable_number(row.bitrate),
      codec: nullable_text(row.codec),
      sample_rate: nullable_number(row.sample_rate),
      lossless: row.lossless === null ? null : Boolean(row.lossless),
      artwork: json_strings(row.artwork),
      resolvers: resolvers.get(id) ?? [],
      tags: tags.get(id) ?? [],
      listen_count: timestamps.length,
      ...(with_timestamps ? { listen_timestamps_ms: timestamps } : {}),
      have_track: owned.has(id),
      added_at_ms: Number(row.added_at_ms)
    }
  })
}

// GET /tracks. One item per track id; tag labels come from every scoped library.
export const list_tracks = ({ db, ...input }: { db: DatabaseSync } & ListTracksInput): Page<TrackRow> => {
  const {
    own_library_address = '',
    library_addresses,
    tags = [],
    query,
    shuffle = false,
    sort = 'added_at',
    order = 'desc',
    offset = 0,
    limit = DEFAULT_LIMIT
  } = input
  assert_page({ offset, limit })
  if (!TRACK_SORTS.includes(sort)) throw new RangeError(`sort must be one of ${TRACK_SORTS.join(', ')}, not ${sort}`)
  if (order !== 'asc' && order !== 'desc') throw new RangeError(`order must be asc or desc, not ${String(order)}`)

  const scoped = library_addresses !== undefined
  const searching = query !== undefined && query.length > 0
  const unique_tags = [...new Set(tags)]
  const filters = [
    searching
      ? "(title LIKE :pattern ESCAPE '\\' OR artist LIKE :pattern ESCAPE '\\' OR album LIKE :pattern ESCAPE '\\' OR remixer LIKE :pattern ESCAPE '\\')"
      : '',
    unique_tags.length > 0
      ? `(SELECT count(DISTINCT tags.tag) FROM tags
          WHERE tags.track_id = matched.track_id
          AND tags.tag IN (SELECT value FROM json_each(:tags))
          ${scoped ? 'AND tags.library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
        ) = :tag_count`
      : ''
  ].filter((filter) => filter.length > 0)
  const from = `FROM (${scoped_tracks_sql({ scoped })}) AS matched ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}`
  const parameters: Record<string, SQLInputValue> = {
    own_library_address,
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}),
    ...(searching ? { pattern: like_pattern(query) } : {}),
    ...(unique_tags.length > 0 ? { tags: JSON.stringify(unique_tags), tag_count: unique_tags.length } : {})
  }

  const column = SORT_COLUMNS[sort]
  const order_by = shuffle
    ? 'random()'
    : `${column.split(' ')[0]} IS NULL, ${column} ${order.toUpperCase()}, track_id ASC`
  const total = Number((db.prepare(`SELECT count(*) AS total ${from}`).get(parameters) as Row).total)
  const rows = db.prepare(`SELECT * ${from} ORDER BY ${order_by} LIMIT :limit OFFSET :offset`)
    .all({ ...parameters, limit, offset }) as Row[]
  return { items: hydrate_tracks({ db, rows, own_library_address, library_addresses }), total }
}

// One track by id, with its listen timestamps; the response for POST and
// DELETE /tags. Undefined when no scoped library holds it.
export const get_track = ({ db, track_id, own_library_address = '', library_addresses }: {
  db: DatabaseSync
  track_id: string
  own_library_address?: string
  library_addresses?: readonly string[]
}): TrackRow | undefined => {
  const scoped = library_addresses !== undefined
  const row = db.prepare(`SELECT * FROM (${scoped_tracks_sql({ scoped })}) WHERE track_id = :track_id`).get({
    track_id,
    own_library_address,
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {})
  }) as Row | undefined
  if (row === undefined) return undefined
  return hydrate_tracks({ db, rows: [row], own_library_address, library_addresses, with_timestamps: true })[0]
}

// GET /tags: tags by the number of distinct live tracks carrying them, most first.
export const list_tags = ({ db, library_addresses }: {
  db: DatabaseSync
  library_addresses?: readonly string[]
}): TagCount[] => {
  const scoped = library_addresses !== undefined
  const rows = db.prepare(`
    SELECT tag, count(DISTINCT track_id) AS count FROM tags
    ${scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
    GROUP BY tag ORDER BY count DESC, tag ASC`
  ).all(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) as Row[]
  return rows.map((row) => ({ tag: String(row.tag), count: Number(row.count) }))
}

// The response for POST /listens. listens_addresses narrows to the given
// listens libraries.
export const get_listen_count = ({ db, track_id, listens_addresses }: {
  db: DatabaseSync
  track_id: string
  listens_addresses?: readonly string[]
}): ListenCount => {
  const scoped = listens_addresses !== undefined
  const timestamps_ms = (db.prepare(`
    SELECT timestamp FROM listens WHERE track_id = :track_id
    ${scoped ? 'AND library_address IN (SELECT value FROM json_each(:listens_addresses))' : ''}
    ORDER BY timestamp DESC, entry_hash`
  ).all({ track_id, ...(scoped ? { listens_addresses: JSON.stringify(listens_addresses) } : {}) }) as Row[]).map((row) => Number(row.timestamp))
  return { track_id, count: timestamps_ms.length, timestamps_ms }
}

// GET /listens: listened tracks by most recent listen, newest first.
// listens_addresses narrows to the given listens libraries.
export const list_listens = ({ db, own_library_address = '', listens_addresses, offset = 0, limit = DEFAULT_LIMIT }: {
  db: DatabaseSync
  own_library_address?: string
  listens_addresses?: readonly string[]
  offset?: number
  limit?: number
}): Page<ListenHistoryItem> => {
  assert_page({ offset, limit })
  const scoped = listens_addresses !== undefined
  const where = scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:listens_addresses))' : ''
  const parameters = scoped ? { listens_addresses: JSON.stringify(listens_addresses) } : {}
  const total = Number((db.prepare(`SELECT count(DISTINCT track_id) AS total FROM listens ${where}`).get(parameters) as Row).total)
  const groups = db.prepare(`
    SELECT track_id, json_group_array(timestamp ORDER BY timestamp DESC, entry_hash) AS timestamps,
      max(timestamp) AS last_listened_at_ms
    FROM listens ${where}
    GROUP BY track_id
    ORDER BY last_listened_at_ms DESC, track_id ASC
    LIMIT :limit OFFSET :offset`
  ).all({ ...parameters, limit, offset }) as Row[]
  const track_rows = db.prepare(`SELECT * FROM (${scoped_tracks_sql({ scoped: false })})
    WHERE track_id IN (SELECT value FROM json_each(:track_ids))`
  ).all({ own_library_address, track_ids: JSON.stringify(groups.map((row) => row.track_id)) }) as Row[]
  const tracks = new Map(hydrate_tracks({ db, rows: track_rows, own_library_address, library_addresses: undefined })
    .map((track) => [track.id, track]))
  const items = groups.map((row) => {
    const track_id = String(row.track_id)
    const timestamps_ms = JSON.parse(String(row.timestamps)) as number[]
    const track = tracks.get(track_id)
    return {
      track_id,
      count: timestamps_ms.length,
      timestamps_ms,
      last_listened_at_ms: Number(row.last_listened_at_ms),
      ...(track === undefined ? {} : { track })
    }
  })
  return { items, total }
}

// Libraries a library links to (§2.5), ordered by address. A link whose log
// payload is not stored yet has no address and is left out.
export const list_linked_libraries = ({ db, library_address }: {
  db: DatabaseSync
  library_address: string
}): LinkedLibrary[] => (db.prepare(`
  SELECT linked_address, alias FROM logs
  WHERE library_address = ? AND linked_address IS NOT NULL
  ORDER BY linked_address`
).all(library_address) as Row[]).map((row) => ({ address: String(row.linked_address), alias: nullable_text(row.alias) }))

// The counts of the API Library shape.
export const get_library_summary = ({ db, library_address }: {
  db: DatabaseSync
  library_address: string
}): LibrarySummary => {
  const row = db.prepare(`
    SELECT
      (SELECT count(*) FROM tracks WHERE library_address = :library_address) AS track_count,
      (SELECT count(*) FROM logs WHERE library_address = :library_address AND linked_address IS NOT NULL) AS linked_library_count,
      (SELECT count(*) FROM entries WHERE library_address = :library_address AND op = 'PUT') AS length`
  ).get({ library_address }) as Row
  return {
    track_count: Number(row.track_count),
    linked_library_count: Number(row.linked_library_count),
    length: Number(row.length)
  }
}

// The library's profile under its canonical about id (§2.6).
export const get_about = ({ db, library_address }: { db: DatabaseSync, library_address: string }): About | undefined => {
  const row = db.prepare('SELECT name, bio, location, avatar FROM about WHERE library_address = ? AND about_id = ?')
    .get(library_address, compute_about_id(library_address)) as Row | undefined
  if (row === undefined) return undefined
  return {
    library_address,
    name: nullable_text(row.name),
    bio: nullable_text(row.bio),
    location: nullable_text(row.location),
    avatar: nullable_text(row.avatar)
  }
}

// The track a library holds under a source pointer (§2.4.2), the §6.4.2
// step 2 cache lookup.
export const find_track_by_source = ({ db, library_address, extractor, id }: {
  db: DatabaseSync
  library_address: string
  extractor: string
  id: string
}): string | undefined => {
  const row = db.prepare('SELECT track_id FROM resolvers WHERE library_address = ? AND extractor = ? AND id = ? LIMIT 1')
    .get(library_address, extractor, id) as Row | undefined
  return row === undefined ? undefined : String(row.track_id)
}
