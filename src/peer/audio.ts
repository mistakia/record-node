// Audio blobs for playback. HEAD reports local availability only; GET reads
// the local store and, on a networked peer, fetches what is missing from
// peers under one deadline (chapter 7 /audio, chapter 8 §8.6.5a). Streaming
// never pins: the blocks it fetched sit in a byte-capped cache and are
// evicted least recently used first, unless a pin has since covered them.
//
// @helia/bitswap 4.0.19 never sends the cancel that follows a received block,
// so the sending peer keeps the want as served and ignores a later want for
// the same block over that connection: an evicted block fetches again only
// from another peer or after the connection cycles.

import type { ContentStore } from '#fabric/content-store.ts'
import type { Network } from '#fabric/network.ts'
import { read_unixfs_file } from '#fabric/unixfs.ts'
import { ProtocolError } from '#types/errors.ts'

export interface AudioSource {
  // The file bytes when every block is local.
  read_local: (cid: string) => Promise<Uint8Array | undefined>
  // The file bytes, fetching missing blocks from peers; undefined when no
  // peer serves them before the deadline.
  read: (cid: string) => Promise<Uint8Array | undefined>
  // The bytes of fetched blocks the cache still tracks.
  cached_bytes: () => number
}

// A missing or non-file blob reads as absent; an invalid CID still throws.
const read_file = async (cid: string, read: (cid: string) => Promise<Uint8Array | undefined>) => {
  try {
    return await read_unixfs_file({ cid, read })
  } catch (error) {
    if (error instanceof ProtocolError && (error.code === 'invalid_shape' || error.code === 'content_unavailable')) return undefined
    throw error
  }
}

export const create_audio_source = ({ content_store, network, timeout_ms, max_bytes }: {
  content_store: ContentStore
  network: Network | undefined
  timeout_ms: number
  max_bytes: number
}): AudioSource => {
  // Fetched block CID to its size, oldest use first.
  const cached = new Map<string, number>()
  let total = 0

  const touch = (cid: string) => {
    const size = cached.get(cid)
    if (size === undefined) return
    cached.delete(cid)
    cached.set(cid, size)
  }

  const remember = (cid: string, size: number) => {
    if (cached.has(cid)) return touch(cid)
    cached.set(cid, size)
    total += size
  }

  // A tracked block a pin now covers leaves the cache but stays stored.
  const trim = async () => {
    for (const [cid, size] of cached) {
      if (total <= max_bytes) return
      cached.delete(cid)
      total -= size
      await content_store.evict(cid)
    }
  }

  const read_local = async (cid: string) => await read_file(cid, content_store.get)

  return {
    read_local,
    read: async (cid) => {
      if (network === undefined) return await read_local(cid)
      const signal = AbortSignal.timeout(timeout_ms)
      const bytes = await read_file(cid, async (block) => {
        const local = await content_store.get(block)
        if (local !== undefined) {
          touch(block)
          return local
        }
        const fetched = signal.aborted ? undefined : await network.fetch_block(block, { signal })
        if (fetched !== undefined) remember(block, fetched.length)
        return fetched
      })
      await trim()
      return bytes
    },
    cached_bytes: () => total
  }
}
