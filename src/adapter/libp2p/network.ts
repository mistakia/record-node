// The Network over a networked Helia (§5.5.1): gossipsub for pubsub, and
// bitswap behind the blockstore for fetch, which stores what it receives.

import type { Connection, IdentifyResult } from '@libp2p/interface'

import { collect_bytes, parse_content_cid } from '#fabric/block.ts'
import type { Network, NetworkPeer } from '#fabric/network.ts'
import type { NetworkedHelia } from './node.ts'
import { create_gossipsub_pubsub } from './pubsub.ts'

type HeliaCid = Parameters<NetworkedHelia['blockstore']['get']>[0]

const peer_of = (connections: Connection[]): NetworkPeer => ({
  peer_id: (connections[0] as Connection).remotePeer.toString(),
  multiaddrs: connections.map(({ remoteAddr }) => remoteAddr.toString()),
  connected_at_ms: Math.min(...connections.map(({ timeline }) => timeline.open))
})

export const create_libp2p_network = ({ helia }: { helia: NetworkedHelia }): Network => {
  const { libp2p } = helia
  const pubsub = create_gossipsub_pubsub({ libp2p })
  return {
    peer_id: libp2p.peerId.toString(),
    pubsub,
    fetch_block: async (cid, { signal }) => {
      try {
        return await collect_bytes(helia.blockstore.get(parse_content_cid(cid) as unknown as HeliaCid, { signal }))
      } catch (error) {
        if (signal.aborted) return undefined
        throw error
      }
    },
    list_peers: () => {
      const by_peer = new Map<string, Connection[]>()
      for (const connection of libp2p.getConnections()) {
        const key = connection.remotePeer.toString()
        by_peer.set(key, [...(by_peer.get(key) ?? []), connection])
      }
      return [...by_peer.values()].map(peer_of)
    },
    addresses: () => libp2p.getMultiaddrs().map(String),
    observations: {
      on_connection_open: (listener) => {
        const handler = ({ detail }: CustomEvent<Connection>) => { listener(detail.remotePeer.toString()) }
        libp2p.addEventListener('connection:open', handler)
        return () => { libp2p.removeEventListener('connection:open', handler) }
      },
      on_peer_identify: (listener) => {
        const handler = ({ detail }: CustomEvent<IdentifyResult>) => { listener(detail.peerId.toString(), detail.agentVersion) }
        libp2p.addEventListener('peer:identify', handler)
        return () => { libp2p.removeEventListener('peer:identify', handler) }
      },
      connected_peer_count: () => new Set(libp2p.getConnections().map(({ remotePeer }) => remotePeer.toString())).size,
      count_rendezvous_addresses: async () => await libp2p.services.mainline_rendezvous?.count_addresses() ?? null
    },
    // Stopping libp2p aborts every dial still queued, and an aborted TCP dial
    // can surface as an uncaught AbortError, so the queue drains first, for
    // at most DIAL_DRAIN_MS.
    close: async () => {
      pubsub.close()
      await dials_drained(libp2p)
    }
  }
}

const DIAL_DRAIN_MS = 3000

export const dials_drained = async (libp2p: { getDialQueue: () => unknown[] }, timeout_ms = DIAL_DRAIN_MS): Promise<void> => {
  const deadline = Date.now() + timeout_ms
  while (libp2p.getDialQueue().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
}
