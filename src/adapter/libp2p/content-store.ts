// ContentStore over a Helia node (§5.5.1): its blockstore for blocks, and the
// shared pin index for retention. Every read passes offline, so a networked
// node behaves the same as an offline one here.
//
// Helia's own pins are not used. Its recursive pins mishandle a block shared
// by two roots in helia 7.1.15-7.1.16, and its pin records are two datastore
// files per block, which on a large library on a slow disk made every pin a
// handful of cold directory lookups.
//
// Eviction deletes from the raw blockstore Helia wraps: Helia's own delete
// first cancels reproviding, which throws on a node with no content router.

import type { DatabaseSync } from 'node:sqlite'
import type { createHeliaLight, Helia } from 'helia'

import { collect_bytes, import_unixfs_file, parse_content_cid as parse_cid, verify_block } from '#fabric/block.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { CommitBatcher } from '#fabric/commit-batch.ts'
import { create_pin_index } from '#fabric/pin-index.ts'

// Helia is on multiformats 14 and the core on 13. The CID classes are
// interchangeable at runtime but distinct types, so cast once, here.
type HeliaCid = Parameters<Helia['blockstore']['get']>[0]

const as_helia_cid = (cid: unknown): HeliaCid => cid as HeliaCid
const parse_content_cid = (cid_string: string): HeliaCid => as_helia_cid(parse_cid(cid_string))

const OFFLINE = { offline: true }

const is_named_error = (error: unknown, name: string) => error instanceof Error && error.name === name

type RawBlockstore = NonNullable<NonNullable<Parameters<typeof createHeliaLight>[0]>['blockstore']>

export const create_helia_content_store = ({ helia, blockstore, pin_db, commit }: {
  helia: Helia
  // The blockstore Helia was created over.
  blockstore: RawBlockstore
  // From open_pin_db.
  pin_db: DatabaseSync
  // Batches pin transactions; the pin index is derived and refilled at open.
  commit?: CommitBatcher | undefined
}): ContentStore => {
  const read_block = async (cid: HeliaCid): Promise<Uint8Array | undefined> => {
    try {
      return await collect_bytes(helia.blockstore.get(cid, OFFLINE))
    } catch (error) {
      if (is_named_error(error, 'BlockNotFoundWhileOfflineError')) return undefined
      throw error
    }
  }

  const pins = create_pin_index({
    db: pin_db,
    read: async (cid) => await read_block(as_helia_cid(cid)),
    has: async (cid) => await blockstore.has(cid as never),
    commit
  })

  return {
    get: async (cid) => await read_block(parse_content_cid(cid)),
    put: async (cid, bytes) => {
      const parsed = parse_cid(cid)
      verify_block({ cid: parsed, bytes })
      await helia.blockstore.put(as_helia_cid(parsed), bytes)
    },
    has: async (cid) => await helia.blockstore.has(parse_content_cid(cid)),
    pin: async (cid, { recursive = false } = {}) => { await pins.pin(parse_cid(cid), recursive) },
    unpin: async (cid) => { await pins.unpin(parse_cid(cid)) },
    is_pinned: async (cid) => pins.is_pinned(parse_cid(cid)),
    evict: async (cid) => {
      const parsed = parse_cid(cid)
      return await pins.evict(parsed, async () => { await blockstore.delete(parsed as never) })
    },
    import_blob: async (source) => await import_unixfs_file({
      source,
      put: async (cid, bytes) => { await helia.blockstore.put(cid, bytes) }
    })
  }
}
