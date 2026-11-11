// Audio blobs for playback. HEAD reports local availability only, checking
// leaves without reading them; GET opens the file and streams the range it
// asks for, reading only the blocks that cover it, and on a networked peer
// fetches what is missing from peers within one request's peer-wait budget
// (chapter 7 /audio, chapter 8 §8.6.5a). Streaming never pins: the blocks it
// fetched sit in a byte-capped cache, trimmed after each fetch, and are
// evicted least recently used first, unless a pin has since covered them.
//
// @helia/bitswap 4.0.19 never sends the cancel that follows a received block,
// so the sending peer keeps the want as served and ignores a later want for
// the same block over that connection: an evicted block fetches again only
// from another peer or after the connection cycles.

import type { ContentStore } from '#fabric/content-store.ts'
import type { Network } from '#fabric/network.ts'
import { has_unixfs_file, open_unixfs_file, read_unixfs_file, type UnixFsFile } from '#fabric/unixfs.ts'
import { ProtocolError } from '#types/errors.ts'
import { create_peer_wait_budget } from './peer-wait-budget.ts'

export interface AudioSource {
  // The file, its blocks read as a range asks for them and fetched from peers
  // when missing until the request closes; undefined when its root is absent,
  // it is no UnixFS file, or no peer serves the root within the budget.
  open: (cid: string, options?: { closed?: AbortSignal | undefined }) => Promise<UnixFsFile | undefined>
  // Whether every block is local, without reading the audio back.
  has_local: (cid: string) => Promise<boolean>
  // The file bytes when every block is local.
  read_local: (cid: string) => Promise<Uint8Array | undefined>
  // The bytes of fetched blocks the cache still tracks.
  cached_bytes: () => number
}

// A missing or non-file blob reads as absent; an invalid CID still throws.
const absent_when_unreadable = async <T>(lookup: Promise<T>, absent: T): Promise<T> => {
  try {
    return await lookup
  } catch (error) {
    if (error instanceof ProtocolError && (error.code === 'invalid_shape' || error.code === 'content_unavailable')) return absent
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

  return {
    open: async (cid, { closed } = {}) => {
      if (network === undefined) return await absent_when_unreadable(open_unixfs_file({ cid, read: content_store.get }), undefined)
      const fetch_within_budget = create_peer_wait_budget({ network, timeout_ms, closed })
      return await absent_when_unreadable(open_unixfs_file({
        cid,
        read: async (block) => {
          const local = await content_store.get(block)
          if (local !== undefined) {
            touch(block)
            return local
          }
          const fetched = await fetch_within_budget(block)
          if (fetched !== undefined) {
            remember(block, fetched.length)
            await trim()
          }
          return fetched
        }
      }), undefined)
    },
    has_local: async (cid) => await absent_when_unreadable(has_unixfs_file({ cid, read: content_store.get, has: content_store.has }), false),
    read_local: async (cid) => await absent_when_unreadable(read_unixfs_file({ cid, read: content_store.get }), undefined),
    cached_bytes: () => total
  }
}
