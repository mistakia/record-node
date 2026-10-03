// The peer's content store: a Helia node over files in the data directory, or
// memory without one. With a network config, Helia runs the §5.5.1 libp2p
// profile with bitswap behind it; without, it has no libp2p, block brokers,
// or routers. Store reads stay local either way; only Network.fetch_block
// reaches peers. Pins are counted in the pin index beside the blocks.

import { opendir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import * as dag_cbor from '@ipld/dag-cbor'
import { FsBlockstore } from 'blockstore-fs'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { FsDatastore } from 'datastore-fs'
import { createHeliaLight, type Helia } from 'helia'

import type { NetworkConfig } from '#adapter/libp2p/config.ts'
import { create_helia_content_store } from '#adapter/libp2p/content-store.ts'
import { create_libp2p_network } from '#adapter/libp2p/network.ts'
import { create_networked_helia } from '#adapter/libp2p/node.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { Network } from '#fabric/network.ts'
import { open_pin_db } from '#fabric/pin-index.ts'
import { data_paths } from './config.ts'

export interface PeerStore {
  readonly helia: Helia
  readonly content_store: ContentStore
  // Set when the store runs the libp2p network.
  readonly network: Network | undefined
  readonly stop: () => Promise<void>
}

// The datastore directories where Helia's pin records were kept before the
// pin index. Nothing reads them; they are deleted in the background.
const RETIRED_PIN_DIRS = ['pin', 'pinned-block']
const UNLINK_BATCH = 1000

const missing = (error: unknown) => (error as { code?: unknown }).code === 'ENOENT'

// Deletes the directories' files one at a time, so a few hundred thousand
// of them never crowd the I/O pool, and resumes at the next start if stopped.
const remove_retired_pin_dirs = async (datastore: string, signal: AbortSignal) => {
  for (const name of RETIRED_PIN_DIRS) {
    const dir = join(datastore, name)
    for (;;) {
      if (signal.aborted) return
      const batch: string[] = []
      try {
        for await (const entry of await opendir(dir)) {
          batch.push(entry.name)
          if (batch.length === UNLINK_BATCH) break
        }
      } catch (error) {
        if (missing(error)) break
        throw error
      }
      if (batch.length === 0) {
        await rmdir(dir)
        break
      }
      for (const file of batch) {
        if (signal.aborted) return
        await unlink(join(dir, file)).catch((error: unknown) => { if (!missing(error)) throw error })
      }
    }
  }
}

export const open_peer_store = async ({ data_dir, network }: {
  data_dir: string | undefined
  network: NetworkConfig | false
}): Promise<PeerStore> => {
  const paths = data_dir === undefined ? undefined : data_paths(data_dir)
  const blockstore = paths === undefined ? new MemoryBlockstore() : new FsBlockstore(paths.blocks)
  const datastore = paths === undefined ? new MemoryDatastore() : new FsDatastore(paths.datastore)
  const pin_db = open_pin_db(paths?.pins)
  const retiring = new AbortController()
  const removal = paths === undefined
    ? Promise.resolve()
    : remove_retired_pin_dirs(paths.datastore, retiring.signal).catch((error: unknown) => {
      process.emitWarning(`removing retired Helia pin records failed: ${(error as Error).message}`)
    })
  const open_helia = async (): Promise<{ helia: Helia, network: Network | undefined }> => {
    if (network === false) return { helia: await createHeliaLight({ blockstore, datastore, codecs: [dag_cbor] }).start(), network: undefined }
    const networked = await create_networked_helia({ blockstore, datastore, network })
    return { helia: networked, network: create_libp2p_network({ helia: networked }) }
  }
  let opened: Awaited<ReturnType<typeof open_helia>>
  try {
    opened = await open_helia()
  } catch (error) {
    retiring.abort()
    await removal
    pin_db.close()
    throw error
  }
  const { helia } = opened
  return {
    helia,
    content_store: create_helia_content_store({ helia, blockstore, pin_db }),
    network: opened.network,
    stop: async () => {
      retiring.abort()
      await removal
      await helia.stop()
      pin_db.close()
    }
  }
}
