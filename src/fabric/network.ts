// The network a peer replicates over (§5.1): pubsub, content-addressed fetch
// from other peers, and the peers it is connected to. The §5.5.1 libp2p
// profile and the in-memory test network both implement it.

import type { PubSub } from './pubsub.ts'

// What the network census (#peer/census.ts) observes; the libp2p network
// provides it, the in-memory test network need not.
export interface NetworkObservations {
  // Each returns its unsubscribe.
  on_connection_open: (listener: (peer_id: string) => void) => () => void
  on_peer_identify: (listener: (peer_id: string, agent: string | undefined) => void) => () => void
  connected_peer_count: () => number
  count_rendezvous_addresses: () => Promise<number | null>
}

export interface NetworkPeer {
  readonly peer_id: string
  readonly multiaddrs: string[]
  readonly connected_at_ms?: number
}

export interface Network {
  readonly peer_id: string
  readonly pubsub: PubSub
  // Fetches one block from other peers and stores it locally. Resolves
  // undefined when no peer serves it before the signal aborts.
  fetch_block: (cid: string, options: { signal: AbortSignal }) => Promise<Uint8Array | undefined>
  list_peers: () => NetworkPeer[]
  // The addresses this peer listens on.
  addresses: () => string[]
  readonly observations?: NetworkObservations
  close: () => Promise<void>
}
