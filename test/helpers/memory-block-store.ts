// Map-backed BlockStore for in-process tests.

import type { BlockStore } from '#types/library.ts'

export const create_memory_block_store = (): BlockStore & { blocks: Map<string, Uint8Array> } => {
  const blocks = new Map<string, Uint8Array>()
  return {
    blocks,
    get: async (cid) => blocks.get(cid),
    put: async (cid, bytes) => { blocks.set(cid, bytes) }
  }
}
