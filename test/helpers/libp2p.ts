// Peers on the real §5.5.1 libp2p profile, in-process on loopback: TCP on
// 127.0.0.1, no mDNS or DHT unless a test turns one on, and nothing reaches
// an external network.

import type { NetworkConfig } from '#adapter/libp2p/config.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { preflight_bypassed } from './network.ts'

export const LOOPBACK: NetworkConfig = { listen: ['/ip4/127.0.0.1/tcp/0'], bootstrap: [], mdns: false, dht: false }

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
    start: async (network: Partial<NetworkConfig> = {}): Promise<Peer> => {
      const peer = await create_peer({
        config: { allow_toolchain_mismatch: preflight_bypassed, traversal_timeout_ms: 5000, network: { ...LOOPBACK, ...network } }
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
