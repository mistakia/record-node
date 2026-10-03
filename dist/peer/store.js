// The peer's content store: a Helia node with no libp2p, block brokers, or
// routers, over files in the data directory or memory without one. The
// replication stage swaps in the §5.5.1 networked node behind the same store.
import * as dag_cbor from '@ipld/dag-cbor';
import { FsBlockstore } from 'blockstore-fs';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';
import { FsDatastore } from 'datastore-fs';
import { createHeliaLight } from 'helia';
import { create_helia_content_store } from '#adapter/libp2p/content-store.ts';
import { data_paths } from "./config.js";
export const open_peer_store = async ({ data_dir }) => {
    const paths = data_dir === undefined ? undefined : data_paths(data_dir);
    const helia = await createHeliaLight({
        blockstore: paths === undefined ? new MemoryBlockstore() : new FsBlockstore(paths.blocks),
        datastore: paths === undefined ? new MemoryDatastore() : new FsDatastore(paths.datastore),
        codecs: [dag_cbor]
    });
    await helia.start();
    return { helia, content_store: create_helia_content_store({ helia }) };
};
