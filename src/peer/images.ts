// Image blobs for display: track artwork and library avatars (chapter 7
// /images). A read takes the whole file under IMAGE_MAX_BYTES, checked from
// the root block before the rest is read. GET reads the local store and, on a
// networked peer, fetches what is missing from peers under one deadline.
// Viewing never stores: the blocks a read fetched are evicted after it unless
// a pin covers them, so images never enter the audio cache. Clients cache by
// CID instead.

import type { ContentStore } from '#fabric/content-store.ts'
import type { Network } from '#fabric/network.ts'
import { read_unixfs_file } from '#fabric/unixfs.ts'
import { ProtocolError } from '#types/errors.ts'

export const IMAGE_MAX_BYTES = 16 * 1024 * 1024

export interface ImageSource {
  // The file bytes when every block is local; undefined when absent or over the cap.
  read_local: (cid: string) => Promise<Uint8Array | undefined>
  // The file bytes, fetching missing blocks from peers; undefined when no
  // peer serves them before the deadline, or over the cap.
  read: (cid: string) => Promise<Uint8Array | undefined>
}

// A missing, non-file, or oversized blob reads as absent; an invalid CID still throws.
const read_file = async (cid: string, read: (cid: string) => Promise<Uint8Array | undefined>) => {
  try {
    return await read_unixfs_file({ cid, read, max_bytes: IMAGE_MAX_BYTES })
  } catch (error) {
    if (error instanceof ProtocolError && (error.code === 'invalid_shape' || error.code === 'content_unavailable' || error.code === 'size_exceeded')) return undefined
    throw error
  }
}

export const create_image_source = ({ content_store, network, timeout_ms }: {
  content_store: ContentStore
  network: Network | undefined
  timeout_ms: number
}): ImageSource => {
  const read_local = async (cid: string) => await read_file(cid, content_store.get)

  return {
    read_local,
    read: async (cid) => {
      if (network === undefined) return await read_local(cid)
      const signal = AbortSignal.timeout(timeout_ms)
      const fetched: string[] = []
      try {
        return await read_file(cid, async (block) => {
          const local = await content_store.get(block)
          if (local !== undefined) return local
          const bytes = signal.aborted ? undefined : await network.fetch_block(block, { signal })
          if (bytes !== undefined) fetched.push(block)
          return bytes
        })
      } finally {
        for (const block of fetched) await content_store.evict(block)
      }
    }
  }
}
