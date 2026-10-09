// Peers on the real §5.5.1 libp2p profile, in-process on loopback: TCP on
// 127.0.0.1, no mDNS, DHT, UPnP, mainline rendezvous or relay server unless a
// test turns one on, and nothing reaches an external network.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadOrCreateSelfKey } from '@libp2p/config'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import DHT from 'bittorrent-dht'
import { FsDatastore } from 'datastore-fs'

import type { NetworkConfig } from '#adapter/libp2p/config.ts'
import type { NetworkedHelia, RecordLibp2p } from '#adapter/libp2p/node.ts'
import { data_paths, type PeerConfig } from '#peer/config.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { preflight_bypassed } from './network.ts'

export const LOOPBACK: NetworkConfig = {
  mode: 'public',
  listen: ['/ip4/127.0.0.1/tcp/0'],
  announce_addresses: [],
  bootstrap: [],
  mdns: false,
  dht: false,
  upnp: false,
  mainline_rendezvous: false,
  relay_server: false
}

// A multiaddr other peers can dial, with the peer id.
export const dial_address = async (peer: Peer): Promise<string> => {
  const { addresses, peer_id } = await peer.get_settings()
  const address = addresses?.find((candidate) => candidate.includes('/tcp/'))
  if (address === undefined) throw new Error(`peer ${peer_id} listens on no TCP address`)
  return address.includes('/p2p/') ? address : `${address}/p2p/${peer_id}`
}

export const create_libp2p_peers = () => {
  const running: Peer[] = []
  return {
    start: async (network: Partial<NetworkConfig> = {}, config: Partial<PeerConfig> = {}): Promise<Peer> => {
      const peer = await create_peer({
        config: { allow_toolchain_mismatch: preflight_bypassed, traversal_timeout_ms: 5000, ...config, network: { ...LOOPBACK, ...network } }
      })
      await start_peer(peer)
      running.push(peer)
      return peer
    },
    stop_all: async () => {
      for (const peer of running.splice(0)) await stop_peer(peer)
    }
  }
}

// The peer's libp2p node.
export const libp2p_of = (peer: Peer): RecordLibp2p => (peer.context.store.helia as NetworkedHelia).libp2p

// A data directory whose libp2p key is made ahead of the peer, so a test can
// name the peer id in another peer's config before either starts. The peer
// loads the key from its datastore as it would any key it made itself.
export const seeded_data_dir = async (): Promise<{ data_dir: string, peer_id: string }> => {
  const data_dir = mkdtempSync(join(tmpdir(), 'record-seeded-'))
  const datastore = new FsDatastore(data_paths(data_dir).datastore)
  await datastore.open()
  const key = await loadOrCreateSelfKey(datastore)
  await datastore.close()
  return { data_dir, peer_id: peerIdFromPrivateKey(key).toString() }
}

// A mainline DHT node on loopback for rendezvous tests, so none reaches the
// public DHT.
export const start_local_dht = async (): Promise<{ address: string, stop: () => Promise<void> }> => {
  const node = new DHT({ bootstrap: false })
  await new Promise<void>((resolve) => { node.listen(0, () => { resolve() }) })
  return {
    address: `127.0.0.1:${node.address().port}`,
    stop: async () => { await new Promise<void>((resolve) => { node.destroy(() => { resolve() }) }) }
  }
}
