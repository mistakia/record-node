// The peer's content store: a Helia node over files in the data directory, or
// memory without one. With a network config, Helia runs the §5.5.1 libp2p
// profile with bitswap behind it; without, it has no libp2p, block brokers,
// or routers. Store reads stay local either way; only Network.fetch_block
// reaches peers.
import * as dag_cbor from '@ipld/dag-cbor';
import { FsBlockstore } from 'blockstore-fs';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';
import { FsDatastore } from 'datastore-fs';
import { createHeliaLight } from 'helia';
import { create_helia_content_store } from '#adapter/libp2p/content-store.ts';
import { create_libp2p_network } from '#adapter/libp2p/network.ts';
import { create_networked_helia } from '#adapter/libp2p/node.ts';
import { data_paths } from "./config.js";
export const open_peer_store = async ({ data_dir, network }) => {
    const paths = data_dir === undefined ? undefined : data_paths(data_dir);
    const blockstore = paths === undefined ? new MemoryBlockstore() : new FsBlockstore(paths.blocks);
    const datastore = paths === undefined ? new MemoryDatastore() : new FsDatastore(paths.datastore);
    if (network === false) {
        const helia = await createHeliaLight({ blockstore, datastore, codecs: [dag_cbor] }).start();
        return { helia, content_store: create_helia_content_store({ helia, blockstore }), network: undefined };
    }
    const helia = await create_networked_helia({ blockstore, datastore, network });
    return { helia, content_store: create_helia_content_store({ helia, blockstore }), network: create_libp2p_network({ helia }) };
};
