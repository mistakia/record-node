// The §5.5.1 network's configuration, apart from the libp2p modules it
// configures, so loading a peer config never loads libp2p.

export interface NetworkConfig {
  // Multiaddrs to listen on.
  readonly listen: readonly string[]
  // The shared bootstrap service: multiaddrs with a /p2p/ peer id.
  readonly bootstrap: readonly string[]
  // Local-network discovery.
  readonly mdns: boolean
  // Content-network native discovery: the libp2p Kademlia DHT.
  readonly dht: boolean
}

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = Object.freeze({
  listen: Object.freeze(['/ip4/0.0.0.0/tcp/0']),
  bootstrap: Object.freeze([]),
  mdns: true,
  dht: true
})
