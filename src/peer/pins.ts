// What a library pins (§3.5.1, §4.6): the three AC chain objects, and per
// entry the signed entry block, the envelope content payload, and item 6
// when the library's replication policy keeps it (§4.6.1): a track's audio
// blob and artwork, and the avatar of the library's About entry. Items 1-5 are dag-cbor leaves and pinned directly;
// item 6 is a UnixFS DAG and pinned recursively.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { compute_about_id } from '#entry/id.ts'
import { is_put } from '#entry/operations.ts'
import { decode_payload, validate_about_content, validate_track_content } from '#entry/payload.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { ProtocolError } from '#types/errors.ts'

// CID to whether the pin is recursive.
export type PinSet = Map<string, boolean>

export const chain_pins = (chain: ResolvedAcChain): Array<[string, boolean]> =>
  [chain.cids.manifest, chain.cids.wrapper, chain.cids.write_list].map((cid) => [cid, false])

// Whether a library keeps an entry's item 6, given its validated content.
export type KeepsBlobs = (input: { entry: VerifiedEntry, content: Record<string, unknown> }) => boolean

// A content payload validated, or undefined when it is not stored or does
// not validate.
const stored_content = async ({ content_store, content_cid, validate }: {
  content_store: ContentStore
  content_cid: string
  validate: (value: unknown) => Record<string, unknown>
}): Promise<Record<string, unknown> | undefined> => {
  const bytes = await content_store.get(content_cid)
  if (bytes === undefined) return undefined
  try {
    return validate(decode_payload(bytes))
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
}

export const stored_track_content = async ({ content_store, content_cid }: {
  content_store: ContentStore
  content_cid: string
}): Promise<Record<string, unknown> | undefined> =>
  await stored_content({ content_store, content_cid, validate: validate_track_content })

export const track_blobs = (content: Record<string, unknown>): string[] =>
  [content.hash as string, ...(content.artwork as string[])]

// Whether an entry can carry item 6: a track, or an About entry.
export const has_item_6 = (entry: VerifiedEntry): boolean =>
  is_put(entry.operation) && (entry.operation.value.type === 'track' || entry.operation.value.type === 'about')

// An entry's item 6 with the validated content that names it, or undefined
// when the entry carries none or its payload is not stored or does not
// validate. Only the library's own About entry counts (§2.6).
export const stored_item_6 = async ({ content_store, library_address, entry }: {
  content_store: ContentStore
  library_address: string
  entry: VerifiedEntry
}): Promise<{ content: Record<string, unknown>, blobs: string[] } | undefined> => {
  if (!is_put(entry.operation)) return undefined
  const { type, id, content: content_cid } = entry.operation.value
  if (type === 'track') {
    const content = await stored_track_content({ content_store, content_cid })
    return content === undefined ? undefined : { content, blobs: track_blobs(content) }
  }
  if (type !== 'about' || id !== compute_about_id(library_address)) return undefined
  const content = await stored_content({ content_store, content_cid, validate: (value) => validate_about_content({ value, library_address }) })
  return content === undefined ? undefined : { content, blobs: typeof content.avatar === 'string' ? [content.avatar] : [] }
}

// A payload not stored yet contributes no item-6 pins; they follow once the
// payload arrives and the entry is pinned again.
export const entry_pins = async ({ content_store, library_address, entry, keeps_blobs }: {
  content_store: ContentStore
  library_address: string
  entry: VerifiedEntry
  keeps_blobs: KeepsBlobs
}): Promise<Array<[string, boolean]>> => {
  const pins: Array<[string, boolean]> = [[entry.hash, false]]
  if (!is_put(entry.operation)) return pins
  pins.push([entry.operation.value.content, false])
  const item = await stored_item_6({ content_store, library_address, entry })
  if (item !== undefined && keeps_blobs({ entry, content: item.content })) pins.push(...item.blobs.map((cid): [string, boolean] => [cid, true]))
  return pins
}

// Pins each CID the store holds and records it in the set. A CID whose blocks
// are not all local yet is left out, so the set holds only real pins.
export const pin_into = async ({ content_store, pins, items }: {
  content_store: ContentStore
  pins: PinSet
  items: Iterable<[string, boolean]>
}): Promise<void> => {
  for (const [cid, recursive] of items) {
    if (pins.get(cid) === true || pins.get(cid) === recursive) continue
    try {
      await content_store.pin(cid, { recursive })
      pins.set(cid, recursive)
    } catch (error) {
      if (!(error instanceof ProtocolError && error.code === 'content_unavailable')) throw error
    }
  }
}
