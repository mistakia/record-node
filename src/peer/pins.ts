// What a library pins (§3.5.1, §4.6): the three AC chain objects, and per
// entry the signed entry block, the envelope content payload, and for a
// track the audio blob and artwork. Items 1-5 are dag-cbor leaves and pinned
// directly; item 6 is a UnixFS DAG and pinned recursively.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { is_put } from '#entry/operations.ts'
import { decode_payload, validate_track_content } from '#entry/payload.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { ProtocolError } from '#types/errors.ts'

// CID to whether the pin is recursive.
export type PinSet = Map<string, boolean>

export const chain_pins = (chain: ResolvedAcChain): Array<[string, boolean]> =>
  [chain.cids.manifest, chain.cids.wrapper, chain.cids.write_list].map((cid) => [cid, false])

// A track payload not stored yet contributes no item-6 pins; they follow once
// the payload arrives and the entry is pinned again.
const track_blob_pins = async ({ content_store, content_cid }: {
  content_store: ContentStore
  content_cid: string
}): Promise<Array<[string, boolean]>> => {
  const bytes = await content_store.get(content_cid)
  if (bytes === undefined) return []
  try {
    const content = validate_track_content(decode_payload(bytes))
    return [content.hash as string, ...(content.artwork as string[])].map((cid) => [cid, true])
  } catch (error) {
    if (error instanceof ProtocolError) return []
    throw error
  }
}

export const entry_pins = async ({ content_store, entry }: {
  content_store: ContentStore
  entry: VerifiedEntry
}): Promise<Array<[string, boolean]>> => {
  const pins: Array<[string, boolean]> = [[entry.hash, false]]
  if (!is_put(entry.operation)) return pins
  const { content, type } = entry.operation.value
  pins.push([content, false])
  if (type === 'track') pins.push(...await track_blob_pins({ content_store, content_cid: content }))
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
