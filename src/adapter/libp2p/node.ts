// The §5.5.1 libp2p profile: gossipsub as the pubsub router, the Record
// pre-shared key on every connection, and Helia with bitswap over it for
// content-addressed fetch. Peer discovery (§5.2) is configuration here: a
// bootstrap list, mDNS, and the content network's own DHT, each able to
// bootstrap the peer alone.

import { getCiphers } from 'node:crypto'

import { bootstrap } from '@libp2p/bootstrap'
import { gossipsub, type GossipSub } from '@libp2p/gossipsub'
import { identify } from '@libp2p/identify'
import type { Libp2p, PeerInfo } from '@libp2p/interface'
import { kadDHT, passthroughMapper } from '@libp2p/kad-dht'
import { mdns } from '@libp2p/mdns'
import { noise, pureJsCrypto } from '@libp2p/noise'
import { ping } from '@libp2p/ping'
import { preSharedKey } from '@libp2p/pnet'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@libp2p/yamux'
import { withBitswap } from '@helia/bitswap'
import { withLibp2pLight } from '@helia/libp2p'
import * as dag_cbor from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { createHeliaLight, type Helia } from 'helia'
import type { Libp2pOptions } from 'libp2p'
import { from as hasher_from } from 'multiformats/hashes/hasher'

import { SHA3_512_CODE } from '#encoding/cid.ts'
import type { NetworkConfig } from './config.ts'

// The swarm key file (§5.5.1): peers with any other key cannot connect.
export const RECORD_SWARM_KEY = '/key/swarm/psk/1.0.0/\n/base16/\ncbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a'

export type RecordServices = {
  identify: ReturnType<ReturnType<typeof identify>>
  ping: ReturnType<ReturnType<typeof ping>>
  pubsub: GossipSub
  dht?: unknown
}

export type RecordLibp2p = Libp2p<RecordServices>
export type NetworkedHelia = Helia & { libp2p: RecordLibp2p }

type HeliaInit = NonNullable<Parameters<typeof createHeliaLight>[0]>
type HeliaHasher = NonNullable<HeliaInit['hashers']>[number]
type Libp2pInit = Parameters<typeof withLibp2pLight>[1]

// Entries and protocol objects are sha3-512 (§2.1), so bitswap must know the
// hasher to verify a block it receives. Helia is on multiformats 14 and the
// core on 13, whose hasher types differ only nominally.
const SHA3_512_HASHER = hasher_from({ name: 'sha3-512', code: SHA3_512_CODE, encode: (bytes) => sha3_512(bytes) }) as unknown as HeliaHasher

// Noise switches to node:crypto's chacha20-poly1305 for larger frames; a
// runtime without that cipher (Bun 1.4) would drop every such frame, so it
// gets the pure-JS implementation instead.
const NOISE_INIT = getCiphers().includes('chacha20-poly1305') ? {} : { crypto: pureJsCrypto }

export const create_libp2p_options = ({ listen, bootstrap: bootstrap_list, mdns: use_mdns, dht }: NetworkConfig): Libp2pOptions<RecordServices> => ({
  addresses: { listen: [...listen] },
  transports: [tcp()],
  connectionEncrypters: [noise(NOISE_INIT)],
  streamMuxers: [yamux()],
  connectionProtector: preSharedKey({ psk: utf8ToBytes(RECORD_SWARM_KEY) }),
  peerDiscovery: [
    ...(bootstrap_list.length > 0 ? [bootstrap({ list: [...bootstrap_list] })] : []),
    ...(use_mdns ? [mdns()] : [])
  ],
  services: {
    identify: identify(),
    ping: ping(),
    // Heads go out on a peer join, before the mesh has formed, so publishing
    // floods to every subscriber and never fails for want of one.
    pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, floodPublish: true }),
    // A private network's peers are reachable on local addresses too.
    ...(dht ? { dht: kadDHT({ clientMode: false, peerInfoMapper: passthroughMapper }) } : {})
  }
})

// Dials each discovered peer, since libp2p only records discoveries.
const dial_discovered = (libp2p: RecordLibp2p) => {
  libp2p.addEventListener('peer:discovery', ({ detail }: CustomEvent<PeerInfo>) => {
    if (libp2p.getConnections(detail.id).length > 0) return
    libp2p.dial(detail.id).catch(() => {})
  })
}

// A started Helia whose blockstore fetches from peers over bitswap unless a
// read passes offline.
export const create_networked_helia = async ({ blockstore, datastore, network }: {
  blockstore: NonNullable<HeliaInit['blockstore']>
  datastore: NonNullable<HeliaInit['datastore']>
  network: NetworkConfig
}): Promise<NetworkedHelia> => {
  const helia = withBitswap(withLibp2pLight(
    createHeliaLight({ blockstore, datastore, codecs: [dag_cbor], hashers: [SHA3_512_HASHER] }),
    create_libp2p_options(network) as unknown as Libp2pInit
  )) as unknown as NetworkedHelia
  await helia.start()
  dial_discovered(helia.libp2p)
  return helia
}
