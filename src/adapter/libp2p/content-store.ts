// ContentStore over a Helia node (§5.5.1): its blockstore for blocks and its
// pin API for retention. Every read passes offline, so a networked node
// behaves the same as an offline one here.
//
// Helia's recursive pins are not used: in helia 7.1.15-7.1.16 pins.rm keeps
// the removed root in a shared block's pinnedBy instead of dropping it, so
// re-pinning that root no longer counts, and unpinning the other root then
// drops a block still under a live pin. Instead each covered block carries a
// depth-0 Helia pin whose metadata counts the pins covering it, so Helia's
// isPinned and gc stay correct.
//
// Eviction deletes from the raw blockstore Helia wraps: Helia's own delete
// first cancels reproviding, which throws on a node with no content router.
//
// Locks are per block and per root, not global, so pins of different blobs
// run side by side; under one global lock, concurrent ingests queued on each
// other's recursive pins. A block's count changes, and evict's pin check and
// delete, hold that block's lock. Pin and unpin of one root hold its root
// lock, so they never interleave.

import type { createHeliaLight, Helia } from 'helia'
import { base58btc } from 'multiformats/bases/base58'

import { collect_bytes, format_cid, import_unixfs_file, parse_content_cid as parse_cid, verify_block, walk_blocks } from '#fabric/block.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import { ProtocolError } from '#types/errors.ts'

// Helia is on multiformats 14 and the core on 13. The CID classes are
// interchangeable at runtime but distinct types, so cast once, here.
type HeliaCid = Parameters<Helia['pins']['get']>[0]

const as_helia_cid = (cid: unknown): HeliaCid => cid as HeliaCid
const parse_content_cid = (cid_string: string): HeliaCid => as_helia_cid(parse_cid(cid_string))

const OFFLINE = { offline: true }

// Metadata on a block's Helia pin: how many pins cover it, and the kind of
// pin made on the block itself, if any.
interface BlockPin {
  references: number
  root?: 'direct' | 'recursive'
}

const is_named_error = (error: unknown, name: string) => error instanceof Error && error.name === name

const drain = async (iterable: AsyncIterable<unknown>) => {
  const iterator = iterable[Symbol.asyncIterator]()
  while ((await iterator.next()).done !== true) { /* consume */ }
}

type RawBlockstore = NonNullable<NonNullable<Parameters<typeof createHeliaLight>[0]>['blockstore']>

export const create_helia_content_store = ({ helia, blockstore }: {
  helia: Helia
  // The blockstore Helia was created over.
  blockstore: RawBlockstore
}): ContentStore => {
  const queues = new Map<string, Promise<unknown>>()
  const exclusive = async <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(key) ?? Promise.resolve()).then(job)
    const settled = run.catch(() => {})
    queues.set(key, settled)
    settled.then(() => { if (queues.get(key) === settled) queues.delete(key) }, () => {})
    return await run
  }
  // Blocks key on the multihash, as the blockstore and Helia's per-block pin
  // record do; roots on the CIDv1, as Helia's pin record does.
  const block_lock = async <T>(cid: HeliaCid, job: () => Promise<T>) =>
    await exclusive(`block:${base58btc.encode(cid.multihash.bytes)}`, job)
  const root_lock = async <T>(cid: HeliaCid, job: () => Promise<T>) => await exclusive(`root:${cid.toV1().toString()}`, job)

  const read_block = async (cid: HeliaCid): Promise<Uint8Array | undefined> => {
    try {
      return await collect_bytes(helia.blockstore.get(cid, OFFLINE))
    } catch (error) {
      if (is_named_error(error, 'BlockNotFoundWhileOfflineError')) return undefined
      throw error
    }
  }

  const covered_by = async ({ cid, recursive }: { cid: HeliaCid, recursive: boolean }) =>
    (await walk_blocks({ cid: parse_cid(format_cid(cid)), recursive, read: async (next) => await read_block(as_helia_cid(next)) }))
      .map(as_helia_cid)

  const get_block_pin = async (cid: HeliaCid): Promise<BlockPin | undefined> => {
    try {
      return (await helia.pins.get(cid)).metadata as unknown as BlockPin
    } catch (error) {
      if (is_named_error(error, 'NotFoundError')) return undefined
      throw error
    }
  }

  const set_block_pin = async (cid: HeliaCid, block_pin: BlockPin) =>
    await helia.pins.setMetadata(cid, { ...block_pin })

  // The block may have been evicted since the pin walked it, while it was
  // still unpinned; the pin then fails rather than count a missing block.
  const reference = async (cid: HeliaCid) => await block_lock(cid, async () => {
    const block_pin = await get_block_pin(cid)
    if (block_pin === undefined) {
      if (!(await blockstore.has(cid as never))) throw new ProtocolError('content_unavailable', `block not stored: ${format_cid(cid)}`)
      await drain(helia.pins.add(cid, { depth: 0, metadata: { references: 1 }, ...OFFLINE }))
    } else {
      await set_block_pin(cid, { ...block_pin, references: block_pin.references + 1 })
    }
  })

  const release = async (cid: HeliaCid) => await block_lock(cid, async () => {
    const block_pin = await get_block_pin(cid)
    if (block_pin === undefined) return
    if (block_pin.references <= 1) {
      await drain(helia.pins.rm(cid))
    } else {
      await set_block_pin(cid, { ...block_pin, references: block_pin.references - 1 })
    }
  })

  // Sets or clears the kind of pin made on a root block, keeping its count.
  const mark_root = async (cid: HeliaCid, root: BlockPin['root']) => await block_lock(cid, async () => {
    const block_pin = await get_block_pin(cid)
    if (block_pin === undefined) return
    const { root: _, ...rest } = block_pin
    await set_block_pin(cid, root === undefined ? rest : { ...rest, root })
  })

  return {
    get: async (cid) => await read_block(parse_content_cid(cid)),
    put: async (cid, bytes) => {
      const parsed = parse_cid(cid)
      verify_block({ cid: parsed, bytes })
      await helia.blockstore.put(as_helia_cid(parsed), bytes)
    },
    has: async (cid) => await helia.blockstore.has(parse_content_cid(cid)),
    pin: async (cid, { recursive = false } = {}) => {
      const parsed = parse_content_cid(cid)
      await root_lock(parsed, async () => {
        const root = (await get_block_pin(parsed))?.root
        if (root === 'recursive' || (root === 'direct' && !recursive)) return
        const covered = await covered_by({ cid: parsed, recursive })
        // A direct pin already counts the root itself.
        const referenced: HeliaCid[] = []
        try {
          for (const block of root === 'direct' ? covered.slice(1) : covered) {
            await reference(block)
            referenced.push(block)
          }
        } catch (error) {
          for (const block of referenced) await release(block)
          throw error
        }
        await mark_root(parsed, recursive ? 'recursive' : 'direct')
      })
    },
    unpin: async (cid) => {
      const parsed = parse_content_cid(cid)
      await root_lock(parsed, async () => {
        const root = (await get_block_pin(parsed))?.root
        if (root === undefined) return
        await mark_root(parsed, undefined)
        for (const block of await covered_by({ cid: parsed, recursive: root === 'recursive' })) await release(block)
      })
    },
    is_pinned: async (cid) => await helia.pins.isPinned(parse_content_cid(cid)),
    evict: async (cid) => {
      const parsed = parse_content_cid(cid)
      return await block_lock(parsed, async () => {
        if (await helia.pins.isPinned(parsed) || !(await blockstore.has(parsed as never))) return false
        await blockstore.delete(parsed as never)
        return true
      })
    },
    import_blob: async (source) => await import_unixfs_file({
      source,
      put: async (cid, bytes) => { await helia.blockstore.put(cid, bytes) }
    })
  }
}
