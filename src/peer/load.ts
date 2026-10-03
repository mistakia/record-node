// Reading a library's oplog back out of the local content store: walk from
// the persisted heads along next and refs, collecting each entry block once.
// Verification is the merge's job, and a block missing locally is skipped.

import { decode_signed_entry } from '#entry/signed.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import { ProtocolError } from '#types/errors.ts'

export const load_entry_blocks = async ({ heads, content_store }: {
  heads: Iterable<string>
  content_store: ContentStore
}): Promise<Uint8Array[]> => {
  const seen = new Set<string>()
  const blocks: Uint8Array[] = []
  const queue = [...heads]
  for (let hash = queue.shift(); hash !== undefined; hash = queue.shift()) {
    if (seen.has(hash)) continue
    seen.add(hash)
    let bytes: Uint8Array | undefined
    try {
      bytes = await content_store.get(hash)
    } catch (error) {
      if (error instanceof ProtocolError) continue
      throw error
    }
    if (bytes === undefined) continue
    blocks.push(bytes)
    try {
      const { entry } = decode_signed_entry(bytes)
      queue.push(...entry.next, ...entry.refs)
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error
    }
  }
  return blocks
}
