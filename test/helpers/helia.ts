// An in-process Helia with no libp2p, block brokers, or routers: nothing
// reaches the network. dag-cbor is registered as createHelia does. The
// content store over it gets the raw blockstore for eviction and an
// in-memory pin index.

import * as dag_cbor from '@ipld/dag-cbor'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { createHeliaLight, type Helia } from 'helia'

import { create_helia_content_store } from '#adapter/libp2p/content-store.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import { open_pin_db } from '#fabric/pin-index.ts'

export const open_offline_helia_store = async (): Promise<{ helia: Helia, content_store: ContentStore }> => {
  const blockstore = new MemoryBlockstore()
  const helia = await createHeliaLight({ blockstore, datastore: new MemoryDatastore(), codecs: [dag_cbor] }).start()
  return { helia, content_store: create_helia_content_store({ helia, blockstore, pin_db: open_pin_db() }) }
}
