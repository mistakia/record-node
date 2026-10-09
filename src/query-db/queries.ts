// Read side of the query index, shaped for the HTTP API routes (spec
// 7-http-api.yaml): track lists, tags, listen history, linked libraries,
// and profiles. Field names follow the API Track schema.

import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite'

import { compute_about_id } from '#entry/id.ts'

export const TRACK_SORTS = ['title', 'artist', 'album', 'bpm', 'duration', 'bitrate', 'listen_count', 'added_at'] as const
export type TrackSort = typeof TRACK_SORTS[number]
export type SortOrder = 'asc' | 'desc'

// A sort's key over the candidate row `t`. Every sort but listen_count has a
// (column, track_id) index (schema.ts), so a page walks limit + offset index
// entries in order instead of sorting every match. A nullable key pages its
// non-null rows and its null rows apart, so nulls come last in both
// directions while one index serves both.
interface SortKey {
  readonly key: string
  readonly nullable_column?: string
}

const SORT_KEYS: Record<TrackSort, SortKey> = {
  title: { key: 't.title COLLATE NOCASE', nullable_column: 't.title' },
  artist: { key: 't.artist COLLATE NOCASE', nullable_column: 't.artist' },
  album: { key: 't.album COLLATE NOCASE', nullable_column: 't.album' },
  bpm: { key: 't.bpm', nullable_column: 't.bpm' },
  duration: { key: 't.duration_seconds', nullable_column: 't.duration_seconds' },
  bitrate: { key: 't.bitrate', nullable_column: 't.bitrate' },
  // Every listen of the track, as Track.listen_count counts them.
  listen_count: { key: '(SELECT count(*) FROM listens WHERE listens.track_id = t.track_id)' },
  added_at: { key: 't.added_at_ms' }
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
  // Every scoped library holding the track live.
  readonly library_addresses: string[]
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
  // content.size summed over live tracks whose payload is stored.
  readonly audio_size_bytes: number
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
  // The requestor's own libraries: their copy of a track represents it, and
  // a track any of them holds is have_track.
  readonly own_library_addresses?: readonly string[] | undefined
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

// Whether `t` is the representative row of its track id across the scoped
// libraries: the requestor's own library first, then the lowest address. The
// probe is one index lookup per row, which in a deep page costs more than
// the walk itself, so a scope where no track id has two rows skips it. The
// unary + keeps the planner off the primary key, so a page walks its sort's
// index.
const representative_sql = ({ scoped, duplicates = true }: { scoped: boolean, duplicates?: boolean }) => {
  const in_scope = (alias: string) => `${alias}.library_address IN (SELECT value FROM json_each(:library_addresses))`
  const rank = (alias: string) => `(NOT ${alias}.library_address IN (SELECT value FROM json_each(:own_library_addresses)), ${alias}.library_address)`
  const probe = `NOT EXISTS (
    SELECT 1 FROM tracks AS o WHERE o.track_id = t.track_id ${scoped ? `AND ${in_scope('o')}` : ''} AND ${rank('o')} < ${rank('t')}
  )`
  return [scoped ? `+${in_scope('t')}` : '', duplicates ? probe : ''].filter((term) => term.length > 0).join(' AND ') || 'TRUE'
}

// Full rows for (library_address, track_id) keys, in the keys' order.
const rows_by_key = (db: DatabaseSync, keys: readonly Row[]): Row[] => {
  const rows = db.prepare(`
    SELECT * FROM tracks
    WHERE (library_address, track_id) IN (SELECT value ->> 0, value ->> 1 FROM json_each(:keys))`
  ).all({ keys: JSON.stringify(keys.map((key) => [key.library_address, key.track_id])) }) as Row[]
  const by_key = new Map(rows.map((row) => [`${String(row.library_address)} ${String(row.track_id)}`, row]))
  return keys
    .map((key) => by_key.get(`${String(key.library_address)} ${String(key.track_id)}`))
    .filter((row): row is Row => row !== undefined)
}

// Match counts by query, kept while the index is unchanged: a count reads
// every matched row, and a client paging one list asks for it on every page.
// The connection's change count moves on its own writes, data_version on any
// other connection's. Neither moves on a rollback, so a count read inside an
// open transaction, as during a commit batch, is never kept.
const MAX_CACHED_COUNTS = 256
const count_cache = new WeakMap<DatabaseSync, { generation: string, counts: Map<string, number> }>()

const cached_count = (db: DatabaseSync, key: string, count: () => number): number => {
  if (db.isTransaction) return count()
  const row = db.prepare('SELECT total_changes() AS changes, data_version FROM pragma_data_version').get() as Row
  const generation = `${String(row.changes)}:${String(row.data_version)}`
  let cache = count_cache.get(db)
  if (cache === undefined || cache.generation !== generation || cache.counts.size >= MAX_CACHED_COUNTS) {
    cache = { generation, counts: new Map() }
    count_cache.set(db, cache)
  }
  const cached = cache.counts.get(key)
  if (cached !== undefined) return cached
  const value = count()
  cache.counts.set(key, value)
  return value
}

// Tags, resolvers, listen counts, and ownership for a page of track rows.
const hydrate_tracks = ({ db, rows, own_library_addresses, library_addresses, with_timestamps = false }: {
  db: DatabaseSync
  rows: readonly Row[]
  own_library_addresses: readonly string[]
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
  const holder_rows = db.prepare(`
    SELECT track_id, library_address FROM tracks
    WHERE track_id IN (SELECT value FROM json_each(:track_ids))
    ${scoped ? 'AND library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
    ORDER BY track_id, library_address`
  ).all({ track_ids, ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) }) as Row[]
  const holders = group_by(holder_rows, 'track_id', (row) => String(row.library_address))
  const owned = new Set((db.prepare(`
    SELECT track_id FROM tracks
    WHERE library_address IN (SELECT value FROM json_each(:own_library_addresses)) AND track_id IN (SELECT value FROM json_each(:track_ids))`
  ).all({ own_library_addresses: JSON.stringify(own_library_addresses), track_ids }) as Row[]).map((row) => String(row.track_id)))

  return rows.map((row) => {
    const id = String(row.track_id)
    const timestamps = listens.get(id) ?? []
    return {
      id,
      library_address: String(row.library_address),
      library_addresses: holders.get(id) ?? [],
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
    own_library_addresses = [],
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
  // Whether two scoped libraries hold one track id, from the track id index.
  const duplicates = cached_count(db, JSON.stringify(['duplicates', library_addresses ?? null]), () => Number((db.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM tracks ${scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
      GROUP BY track_id HAVING count(*) > 1
    ) AS duplicates`
  ).get(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) as Row).duplicates)) === 1
  const filters = [
    representative_sql({ scoped, duplicates }),
    searching
      ? "(t.title LIKE :pattern ESCAPE '\\' OR t.artist LIKE :pattern ESCAPE '\\' OR t.album LIKE :pattern ESCAPE '\\' OR t.remixer LIKE :pattern ESCAPE '\\')"
      : '',
    unique_tags.length > 0
      ? `t.track_id IN (
          SELECT track_id FROM tags
          WHERE tag IN (SELECT value FROM json_each(:tags))
          ${scoped ? 'AND library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
          GROUP BY track_id HAVING count(DISTINCT tag) = :tag_count
        )`
      : ''
  ].filter((filter) => filter.length > 0)
  const where = filters.join(' AND ')
  const parameters: Record<string, SQLInputValue> = {
    ...(duplicates ? { own_library_addresses: JSON.stringify(own_library_addresses) } : {}),
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}),
    ...(searching ? { pattern: like_pattern(query) } : {}),
    ...(unique_tags.length > 0 ? { tags: JSON.stringify(unique_tags), tag_count: unique_tags.length } : {})
  }
  const count = (condition: string) => cached_count(db, JSON.stringify([condition, parameters]), () =>
    Number((db.prepare(`SELECT count(*) AS total FROM tracks AS t WHERE ${where} ${condition}`).get(parameters) as Row).total))
  const keys = (condition: string, order_by: string, page: { offset: number, limit: number }) =>
    db.prepare(`SELECT t.library_address, t.track_id FROM tracks AS t WHERE ${where} ${condition} ORDER BY ${order_by} LIMIT :limit OFFSET :offset`)
      .all({ ...parameters, ...page }) as Row[]

  const total = count('')
  const direction = order.toUpperCase()
  const { key, nullable_column } = SORT_KEYS[sort]
  let page_keys: Row[]
  if (shuffle) {
    page_keys = keys('', 'random()', { offset, limit })
  } else if (nullable_column === undefined) {
    page_keys = keys('', `${key} ${direction}, t.track_id ${direction}`, { offset, limit })
  } else {
    // Non-null keys first, then the null-key rows by track id.
    const present = keys(`AND ${nullable_column} IS NOT NULL`, `${key} ${direction}, t.track_id ${direction}`, { offset, limit })
    const absent = present.length === limit
      ? []
      : keys(`AND ${nullable_column} IS NULL`, `t.track_id ${direction}`, {
        offset: present.length > 0 ? 0 : offset - count(`AND ${nullable_column} IS NOT NULL`),
        limit: limit - present.length
      })
    page_keys = [...present, ...absent]
  }
  return { items: hydrate_tracks({ db, rows: rows_by_key(db, page_keys), own_library_addresses, library_addresses }), total }
}

// One track by id, with its listen timestamps; the response for POST and
// DELETE /tags. Undefined when no scoped library holds it.
export const get_track = ({ db, track_id, own_library_addresses = [], library_addresses }: {
  db: DatabaseSync
  track_id: string
  own_library_addresses?: readonly string[]
  library_addresses?: readonly string[]
}): TrackRow | undefined => {
  const scoped = library_addresses !== undefined
  const row = db.prepare(`SELECT t.* FROM tracks AS t WHERE t.track_id = :track_id AND ${representative_sql({ scoped })}`).get({
    track_id,
    own_library_addresses: JSON.stringify(own_library_addresses),
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {})
  }) as Row | undefined
  if (row === undefined) return undefined
  return hydrate_tracks({ db, rows: [row], own_library_addresses, library_addresses, with_timestamps: true })[0]
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
export const list_listens = ({ db, own_library_addresses = [], listens_addresses, offset = 0, limit = DEFAULT_LIMIT }: {
  db: DatabaseSync
  own_library_addresses?: readonly string[]
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
  const track_rows = db.prepare(`SELECT t.* FROM tracks AS t
    WHERE t.track_id IN (SELECT value FROM json_each(:track_ids)) AND ${representative_sql({ scoped: false })}`
  ).all({ own_library_addresses: JSON.stringify(own_library_addresses), track_ids: JSON.stringify(groups.map((row) => row.track_id)) }) as Row[]
  const tracks = new Map(hydrate_tracks({ db, rows: track_rows, own_library_addresses, library_addresses: undefined })
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
      (SELECT coalesce(sum(audio_size_bytes), 0) FROM tracks WHERE library_address = :library_address) AS audio_size_bytes,
      (SELECT count(*) FROM logs WHERE library_address = :library_address AND linked_address IS NOT NULL) AS linked_library_count,
      (SELECT count(*) FROM entries WHERE library_address = :library_address AND op = 'PUT') AS length`
  ).get({ library_address }) as Row
  return {
    track_count: Number(row.track_count),
    audio_size_bytes: Number(row.audio_size_bytes),
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
