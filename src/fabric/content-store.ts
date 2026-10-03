// Content-addressed storage boundary (§4.6, §5.5.1). CIDs cross it as
// base58btc strings, the form entries carry (§2.1, §2.4.1). The store is
// local: nothing behind it fetches from the network.

import type { BlockStore } from '#types/library.ts'

// §5.5.1: audio blobs and artwork are imported with this profile and no
// option it sets, since an explicit importer option overrides the profile.
export const CONTENT_IMPORT_PROFILE = 'unixfs-v1-2025'

// A file path, the blob bytes, or a byte stream (a Node Readable qualifies).
export type BlobSource = string | Uint8Array | AsyncIterable<Uint8Array>

export interface PinOptions {
  // Pin every block under the CID (§4.6 item 6). Otherwise only the block itself.
  readonly recursive?: boolean
}

export interface ContentStore extends BlockStore {
  get: (cid: string) => Promise<Uint8Array | undefined>
  // Rejects with cid_mismatch when the bytes do not hash to the CID.
  put: (cid: string, bytes: Uint8Array) => Promise<void>
  has: (cid: string) => Promise<boolean>
  // Idempotent, and a recursive pin supersedes a direct one. Rejects with
  // content_unavailable when a block the pin covers is not stored.
  pin: (cid: string, options?: PinOptions) => Promise<void>
  // Idempotent. Removes the pin made on this CID, not one on an ancestor.
  unpin: (cid: string) => Promise<void>
  // True for a pinned CID and for any block under a recursive pin.
  is_pinned: (cid: string) => Promise<boolean>
  // Imports one blob as a single UnixFS file and returns its base58btc CID.
  import_blob: (source: BlobSource) => Promise<string>
}
