// Read side of the query index, shaped for the HTTP API routes (spec
// 7-http-api.yaml): track lists, labels, listen history, and profiles. Field
// names follow the API Track schema. Membership and labelling are separate
// scopes: library_addresses picks the libraries whose live tracks are in
// scope, and label_libraries the libraries whose labels count (§2.5).

import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite'

import { ABOUT_KEY } from '#entry/records.ts'

export const TRACK_SORTS = ['title', 'artist', 'album', 'bpm', 'duration', 'bitrate', 'listen_count', 'added_at'] as const
export type TrackSort = typeof TRACK_SORTS[number]
export type SortOrder = 'asc' | 'desc'

// A sort's key over the candidate row `t`. Every sort has a
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
  // Every listen of the track, as Track.listen_count counts them, kept on the
  // row by the listens triggers (schema.ts).
  listen_count: { key: 't.listen_count' },
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

// One track id's labels in one library (the API LabelState).
export interface LabelState {
  readonly track_id: string
  readonly tags: string[]
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
  // The libraries whose labels filter and hydrate; undefined is every one.
  readonly label_libraries?: readonly string[] | undefined
  // AND semantics: a track matches when it carries every tag.
  readonly tags?: readonly string[] | undefined
  // A track matches when it carries a label of every group.
  readonly tag_groups?: ReadonlyArray<readonly string[]> | undefined
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

// A trigram index matches a substring of at least three characters; a
// shorter query falls back to the LIKE scan.
const TRIGRAM = 3

// The query as one FTS5 phrase, which the trigram index matches as a
// case-insensitive substring of a single column.
const search_phrase = (query: string): string => `"${query.replaceAll('"', '""')}"`

const MATCHED_KEYS = 'SELECT k.library_address, k.track_id FROM track_search AS s JOIN track_search_keys AS k ON k.id = s.rowid WHERE track_search MATCH :phrase'

// Up to this many matches, a search page reads them and sorts them; past it,
// walking the sort's index and testing each row against the matches reaches a
// page sooner. Measured on 206k tracks, the two cross near 8,000.
const SORTED_MATCHES_MAX = 5000

// Where a statement reads the tracks in scope from, and the filter that
// source adds. Every other filter names only t.library_address and
// t.track_id, so a count of matches reads their keys alone.
type TrackSource = 'tracks' | 'match_keys' | 'match_rows' | 'tested_rows'
const track_source = (source: TrackSource): { from: string, filter: string } => ({
  tracks: { from: 'tracks AS t', filter: '' },
  match_keys: { from: 'track_search AS s JOIN track_search_keys AS t ON t.id = s.rowid', filter: 'track_search MATCH :phrase AND ' },
  match_rows: {
    from: 'track_search AS s JOIN track_search_keys AS k ON k.id = s.rowid JOIN tracks AS t ON t.library_address = k.library_address AND t.track_id = k.track_id',
    filter: 'track_search MATCH :phrase AND '
  },
  // The unary + keeps the planner from driving the page off the matches.
  tested_rows: { from: 'tracks AS t', filter: `(+t.library_address, +t.track_id) IN (${MATCHED_KEYS}) AND ` }
})[source]

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

// The libraries whose labels count, as a subquery: the given ones, or every
// library the index holds, a projection marker or a track row each, so a
// label read always narrows by library_address and reads an index.
const label_scope = (label_libraries: readonly string[] | undefined): string => label_libraries === undefined
  ? 'SELECT library_address FROM library_heads UNION SELECT library_address FROM library_totals'
  : 'SELECT value FROM json_each(:label_libraries)'

const label_parameters = (label_libraries: readonly string[] | undefined): Record<string, string> =>
  label_libraries === undefined ? {} : { label_libraries: JSON.stringify(label_libraries) }

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

// Counts by query, kept while the index is unchanged: a match count reads
// every matched row, and a client paging one list asks for it on every page;
// tag counts read every label of the scoped libraries, and a client asks for
// them on every index event. The connection's change count moves on its own
// writes, data_version on any other connection's. Neither moves on a
// rollback, so a count read inside an open transaction, as during a commit
// batch, is never kept.
const MAX_CACHED_COUNTS = 256
const count_cache = new WeakMap<DatabaseSync, { generation: string, counts: Map<string, unknown> }>()

const cached_count = <T>(db: DatabaseSync, key: string, count: () => T): T => {
  if (db.isTransaction) return count()
  const row = db.prepare('SELECT total_changes() AS changes, data_version FROM pragma_data_version').get() as Row
  const generation = `${String(row.changes)}:${String(row.data_version)}`
  let cache = count_cache.get(db)
  if (cache === undefined || cache.generation !== generation || cache.counts.size >= MAX_CACHED_COUNTS) {
    cache = { generation, counts: new Map() }
    count_cache.set(db, cache)
  }
  if (cache.counts.has(key)) return cache.counts.get(key) as T
  const value = count()
  cache.counts.set(key, value)
  return value
}

// Labels, resolvers, listen counts, and ownership for a page of track rows.
// A track's labels are those the label_libraries apply to its id, whichever
// library holds it (§2.5).
const hydrate_tracks = ({ db, rows, own_library_addresses, library_addresses, label_libraries, with_timestamps = false }: {
  db: DatabaseSync
  rows: readonly Row[]
  own_library_addresses: readonly string[]
  library_addresses: readonly string[] | undefined
  label_libraries: readonly string[] | undefined
  with_timestamps?: boolean
}): TrackRow[] => {
  const track_ids = JSON.stringify(rows.map((row) => row.track_id))
  const scoped = library_addresses !== undefined
  const tag_rows = db.prepare(`
    SELECT track_id, library_address, tag FROM tags
    WHERE track_id IN (SELECT value FROM json_each(:track_ids)) AND library_address IN (${label_scope(label_libraries)})
    ORDER BY track_id, library_address, tag`
  ).all({ track_ids, ...label_parameters(label_libraries) }) as Row[]
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
    label_libraries,
    tags = [],
    tag_groups = [],
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
  const indexed = searching && [...query].length >= TRIGRAM
  // Every group must match, by any of its labels; a tags label is a group of one.
  const groups = [...new Set(tags)].map((tag) => [tag]).concat(tag_groups.map((group) => [...new Set(group)]))
  // Whether two scoped libraries hold one track id, from the track id index;
  // the primary key rules it out within one library.
  const duplicates = !(scoped && new Set(library_addresses).size <= 1) && cached_count(db, JSON.stringify(['duplicates', library_addresses ?? null]), () => Number((db.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM tracks INDEXED BY tracks_by_track_id ${scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}
      GROUP BY track_id HAVING count(*) > 1
    ) AS duplicates`
  ).get(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) as Row).duplicates)) === 1
  // A label group as a filter, over the labels of label_libraries: by
  // default the set of track ids carrying a label in it, read once by
  // (library, label); correlated, a probe of each walked row's track id.
  const labels_from = label_scope(label_libraries)
  const group_filter = (index: number, correlated: boolean) => correlated
    ? `EXISTS (SELECT 1 FROM tags AS g WHERE g.track_id = t.track_id
          AND g.tag IN (SELECT value FROM json_each(:tag_group_${index})) AND g.library_address IN (${labels_from}))`
    : `t.track_id IN (
          SELECT track_id FROM tags
          WHERE library_address IN (${labels_from}) AND tag IN (SELECT value FROM json_each(:tag_group_${index}))
        )`
  const where_for = (correlated: boolean) => [
    representative_sql({ scoped, duplicates }),
    searching && !indexed
      ? "(t.title LIKE :pattern ESCAPE '\\' OR t.artist LIKE :pattern ESCAPE '\\' OR t.album LIKE :pattern ESCAPE '\\' OR t.remixer LIKE :pattern ESCAPE '\\')"
      : '',
    ...groups.map((_, index) => group_filter(index, correlated))
  ].filter((filter) => filter.length > 0).join(' AND ')
  const where = where_for(false)
  const parameters: Record<string, SQLInputValue> = {
    ...(duplicates ? { own_library_addresses: JSON.stringify(own_library_addresses) } : {}),
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}),
    ...(groups.length > 0 ? label_parameters(label_libraries) : {}),
    ...(indexed ? { phrase: search_phrase(query) } : searching ? { pattern: like_pattern(query) } : {}),
    ...Object.fromEntries(groups.map((group, index) => [`tag_group_${index}`, JSON.stringify(group)]))
  }
  const count = (condition: string) => cached_count(db, JSON.stringify([condition, parameters]), () => {
    const { from, filter } = track_source(!indexed ? 'tracks' : condition === '' ? 'match_keys' : 'match_rows')
    return Number((db.prepare(`SELECT count(*) AS total FROM ${from} WHERE ${filter}${where} ${condition}`).get(parameters) as Row).total)
  })
  // Every scoped row, from the trigger-kept totals without reading the rows.
  const scope_total = () => Number((db.prepare(`SELECT coalesce(sum(track_count), 0) AS total FROM library_totals
        ${scoped ? 'WHERE library_address IN (SELECT value FROM json_each(:library_addresses))' : ''}`
  ).get(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}) as Row).total)
  // Label-filtered without a search, the page lists one item per track id,
  // so the total is the groups' intersection, read from the (library, label,
  // track id) index, cut to the track ids a scoped library holds live: a
  // label may name a track no library in scope holds (§2.5).
  const labelled = groups.length > 0 && !searching
  const label_count = () => cached_count(db, JSON.stringify(['labels', parameters]), () => {
    const sets = groups.map((_, index) =>
      `SELECT track_id FROM tags WHERE library_address IN (${labels_from}) AND tag IN (SELECT value FROM json_each(:tag_group_${index}))`)
    const held = `EXISTS (SELECT 1 FROM tracks AS h WHERE h.track_id = m.track_id
      ${scoped ? 'AND h.library_address IN (SELECT value FROM json_each(:library_addresses))' : ''})`
    const { own_library_addresses: _own, ...used } = parameters
    return Number((db.prepare(`SELECT count(*) AS total FROM (${sets.join(' INTERSECT ')}) AS m WHERE ${held}`).get(used) as Row).total)
  })
  const total = labelled ? label_count() : searching || groups.length > 0 || duplicates ? count('') : scope_total()
  // A labelled page either sorts every match, or walks the sort's index
  // probing each row's labels until the page fills: about (offset + limit)
  // times scope / total rows. A probe costs about twice a sorted match
  // (measured on 206k tracks), so the walk wins while it reads under half as
  // many rows as there are matches: a broad filter's first pages. The
  // estimate assumes labels spread evenly along the sort, and a shuffled page
  // cannot stop early, so it always sorts.
  const walked = labelled && !shuffle && total > 0 && 2 * (offset + limit) * scope_total() / total < total
  const page_where = walked ? where_for(true) : where
  const keys = (condition: string, order_by: string, page: { offset: number, limit: number }) => {
    const { from, filter } = track_source(!indexed ? 'tracks' : total <= SORTED_MATCHES_MAX ? 'match_rows' : 'tested_rows')
    return db.prepare(`SELECT t.library_address, t.track_id FROM ${from} WHERE ${filter}${page_where} ${condition} ORDER BY ${order_by} LIMIT :limit OFFSET :offset`)
      .all({ ...parameters, ...page }) as Row[]
  }
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
  return { items: hydrate_tracks({ db, rows: rows_by_key(db, page_keys), own_library_addresses, library_addresses, label_libraries }), total }
}

// One track by id, with its listen timestamps; the response for a label
// write. Undefined when no scoped library holds it.
export const get_track = ({ db, track_id, own_library_addresses = [], library_addresses, label_libraries }: {
  db: DatabaseSync
  track_id: string
  own_library_addresses?: readonly string[]
  library_addresses?: readonly string[] | undefined
  label_libraries?: readonly string[] | undefined
}): TrackRow | undefined => {
  const scoped = library_addresses !== undefined
  const row = db.prepare(`SELECT t.* FROM tracks AS t WHERE t.track_id = :track_id AND ${representative_sql({ scoped })}`).get({
    track_id,
    own_library_addresses: JSON.stringify(own_library_addresses),
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {})
  }) as Row | undefined
  if (row === undefined) return undefined
  return hydrate_tracks({ db, rows: [row], own_library_addresses, library_addresses, label_libraries, with_timestamps: true })[0]
}

// GET /tags: each label a library in label_libraries applies to a live track
// in the membership scope, by the number of such tracks, most first. A prefix
// bounds the labels by range, so it reads only theirs: every label starting
// with it sorts at or after it and before it followed by the byte 0xff, which
// UTF-8 never contains.
export const list_tags = ({ db, library_addresses, label_libraries, prefix }: {
  db: DatabaseSync
  library_addresses?: readonly string[] | undefined
  label_libraries?: readonly string[] | undefined
  prefix?: string | undefined
}): readonly TagCount[] => cached_count(db, JSON.stringify(['tags', library_addresses ?? null, label_libraries ?? null, prefix ?? null]), () => {
  const scoped = library_addresses !== undefined
  const rows = db.prepare(`
    SELECT g.tag, count(DISTINCT g.track_id) AS count FROM tags AS g
    WHERE g.library_address IN (${label_scope(label_libraries)})
      ${prefix === undefined ? '' : "AND g.tag >= :prefix AND g.tag < :prefix || CAST(x'ff' AS TEXT)"}
      AND EXISTS (SELECT 1 FROM tracks AS t WHERE t.track_id = g.track_id
        ${scoped ? 'AND t.library_address IN (SELECT value FROM json_each(:library_addresses))' : ''})
    GROUP BY g.tag ORDER BY count DESC, g.tag ASC`
  ).all({
    ...(scoped ? { library_addresses: JSON.stringify(library_addresses) } : {}),
    ...label_parameters(label_libraries),
    ...(prefix === undefined ? {} : { prefix })
  }) as Row[]
  return rows.map((row) => ({ tag: String(row.tag), count: Number(row.count) }))
})

// The labels the label_libraries apply to one track id, held or not, sorted.
export const track_labels = ({ db, track_id, label_libraries }: {
  db: DatabaseSync
  track_id: string
  label_libraries: readonly string[]
}): string[] => (db.prepare(`
  SELECT DISTINCT tag FROM tags
  WHERE track_id = :track_id AND library_address IN (SELECT value FROM json_each(:label_libraries))
  ORDER BY tag`
).all({ track_id, label_libraries: JSON.stringify(label_libraries) }) as Row[]).map((row) => String(row.tag))

// GET /libraries/{address}/labels: every track id the library applies a label
// to, held by any library or not, by track id, with its labels (§2.5).
export const list_library_labels = ({ db, library_address, offset = 0, limit = DEFAULT_LIMIT }: {
  db: DatabaseSync
  library_address: string
  offset?: number | undefined
  limit?: number | undefined
}): Page<LabelState> => {
  assert_page({ offset, limit })
  const total = cached_count(db, JSON.stringify(['library_labels', library_address]), () => Number((db.prepare(
    'SELECT count(*) AS total FROM (SELECT DISTINCT track_id FROM tags WHERE library_address = ?)'
  ).get(library_address) as Row).total))
  const items = (db.prepare(`
    SELECT track_id, json_group_array(tag ORDER BY tag) AS tags FROM tags
    WHERE library_address = :library_address
    GROUP BY track_id ORDER BY track_id
    LIMIT :limit OFFSET :offset`
  ).all({ library_address, limit, offset }) as Row[]).map((row) => ({ track_id: String(row.track_id), tags: json_strings(row.tags) }))
  return { items, total }
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
export const list_listens = ({ db, own_library_addresses = [], listens_addresses, label_libraries, offset = 0, limit = DEFAULT_LIMIT }: {
  db: DatabaseSync
  own_library_addresses?: readonly string[]
  listens_addresses?: readonly string[]
  label_libraries?: readonly string[] | undefined
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
  const tracks = new Map(hydrate_tracks({ db, rows: track_rows, own_library_addresses, library_addresses: undefined, label_libraries })
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

// The counts of the API Library shape, from the trigger-kept library_totals
// row (schema.ts); a library with no rows has none. A link is an identity
// library record (§4.8.4), which no recordstore carries, so none links.
export const get_library_summary = ({ db, library_address }: {
  db: DatabaseSync
  library_address: string
}): LibrarySummary => {
  const row = db.prepare('SELECT track_count, audio_size_bytes, put_count FROM library_totals WHERE library_address = ?')
    .get(library_address) as Row | undefined
  return {
    track_count: Number(row?.track_count ?? 0),
    audio_size_bytes: Number(row?.audio_size_bytes ?? 0),
    linked_library_count: 0,
    length: Number(row?.put_count ?? 0)
  }
}

// The library's profile under its canonical about id (§2.6).
export const get_about = ({ db, library_address }: { db: DatabaseSync, library_address: string }): About | undefined => {
  const row = db.prepare('SELECT name, bio, location, avatar FROM about WHERE library_address = ? AND about_id = ?')
    .get(library_address, ABOUT_KEY) as Row | undefined
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
