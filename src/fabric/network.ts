// The network a peer replicates over (§5.1): pubsub, content-addressed fetch
// from other peers, and the peers it is connected to. The §5.5.1 libp2p
// profile and the in-memory test network both implement it.

import type { PubSub } from './pubsub.ts'

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
  close: () => Promise<void>
}
