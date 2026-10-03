// An in-process Helia with no libp2p, block brokers, or routers: nothing
// reaches the network. dag-cbor is registered as createHelia does.

import * as dag_cbor from '@ipld/dag-cbor'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { createHeliaLight, type Helia } from 'helia'

export const create_offline_helia = async (): Promise<Helia> =>
  await createHeliaLight({
    blockstore: new MemoryBlockstore(),
    datastore: new MemoryDatastore(),
    codecs: [dag_cbor]
  }).start()
