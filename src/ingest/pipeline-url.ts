// URL ingest (§6.4.2). Step 1, resolution, is the caller's: a URL can name
// several sources, and the import reports progress per source. Each resolved
// record then runs steps 2-4 here.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { to_resolver_entry, type ResolvedEntry, type ResolverEntry } from 'record-resolver'

import type { IngestedTrack } from '#types/ingest.ts'
import type { Download } from './download.ts'
import { ingest_local_file } from './pipeline-local.ts'
import type { TrackTarget } from './put-track.ts'
import type { Toolchain } from './toolchain.ts'

// The library's track for a source pointer, if it has one (§2.4.2 cache key).
export type FindBySource = (source: { extractor: string, id: string }) => IngestedTrack | undefined

// yt-dlp names the container in ext; the stripped copy keeps it (§6.4.1 step 6).
const extension_of = ({ ext, url }: ResolvedEntry): string => {
  if (typeof ext === 'string' && /^[0-9a-z]+$/i.test(ext)) return `.${ext}`
  return extname(new URL(url).pathname)
}

export const ingest_resolved_entry = async ({ entry, target, toolchain, find_by_source, download, tags, timestamp }: {
  entry: ResolvedEntry
  target: TrackTarget
  toolchain: Toolchain
  find_by_source: FindBySource
  download: Download
  tags?: readonly string[]
  timestamp?: number
}): Promise<IngestedTrack> => {
  // Step 4's strip happens first, so nothing downstream ever holds the
  // streaming url, ext, or request headers (§2.4.2).
  const resolver: ResolverEntry = to_resolver_entry(entry)
  // Step 2: an already-ingested source returns its track without a download.
  const existing = find_by_source(resolver)
  if (existing !== undefined) return existing
  const temp_dir = await mkdtemp(join(tmpdir(), 'record-download-'))
  try {
    // Step 3: the audio stream to a temporary file.
    const file_path = join(temp_dir, `download${extension_of(entry)}`)
    await download({ url: entry.url, headers: entry.http_headers, output_path: file_path })
    // Step 4: the local pipeline, with the stripped record attached.
    return await ingest_local_file({
      file_path,
      target,
      toolchain,
      resolver: [{ ...resolver }],
      ...(tags === undefined ? {} : { tags }),
      ...(timestamp === undefined ? {} : { timestamp })
    })
  } finally {
    await rm(temp_dir, { recursive: true, force: true })
  }
}
