// The §5.5.1 libp2p profile: gossipsub as the pubsub router, the Record
// pre-shared key on every connection, and Helia with bitswap over it for
// content-addressed fetch. Peer discovery (§5.2) is configuration here: a
// bootstrap list, mDNS, the content network's own DHT, and the mainline
// rendezvous. The §5.6 network mode decides which of those run, the §5.5.2
// NAT traversal set, and what the node may listen on, advertise and dial.

import { getCiphers } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { autoNAT } from '@libp2p/autonat'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { gossipsub, type GossipSub } from '@libp2p/gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import type { ConnectionGater, Libp2p, PeerId, PeerInfo } from '@libp2p/interface'
import { kadDHT, passthroughMapper, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { mdns } from '@libp2p/mdns'
import { noise, pureJsCrypto } from '@libp2p/noise'
import { ping } from '@libp2p/ping'
import { preSharedKey } from '@libp2p/pnet'
import { tcp } from '@libp2p/tcp'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { isPrivate } from '@libp2p/utils'
import { yamux } from '@libp2p/yamux'
import { withBitswap } from '@helia/bitswap'
import { withLibp2pLight } from '@helia/libp2p'
import * as dag_cbor from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { createHeliaLight, type Helia } from 'helia'
import type { Libp2pOptions } from 'libp2p'
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr'
import { from as hasher_from } from 'multiformats/hashes/hasher'

import { SHA3_512_CODE } from '#encoding/cid.ts'
import type { NetworkConfig, NetworkMode } from './config.ts'
import { mainline_rendezvous, type MainlineRendezvousService } from './mainline-rendezvous.ts'
import { tor_transport } from './tor-transport.ts'

// The swarm key file (§5.5.1): peers with any other key cannot connect.
export const RECORD_SWARM_KEY = '/key/swarm/psk/1.0.0/\n/base16/\ncbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a'

export type RecordServices = {
  identify: ReturnType<ReturnType<typeof identify>>
  ping: ReturnType<ReturnType<typeof ping>>
  pubsub: GossipSub
  dht?: unknown
  mainline_rendezvous?: MainlineRendezvousService
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

const VERSION = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version

// §5.6.4: the mode, and no runtime or operating system.
export const agent_string = (mode: NetworkMode, version = VERSION): string =>
  `record-node/${version.split('.').slice(0, 2).join('.')} (${mode})`

const CIRCUIT = '/p2p-circuit'

const is_circuit = (address: Multiaddr) => address.getComponents().some(({ name }) => name === 'p2p-circuit')

// The address before /p2p-circuit names the relay; true when it is the named
// relay, by peer id.
const through_relay = (address: Multiaddr, relay_peer_id: string): boolean => {
  const text = address.toString()
  const before = text.slice(0, text.indexOf(CIRCUIT))
  return before.endsWith(`/p2p/${relay_peer_id}`)
}

const same_host_and_port = (left: Multiaddr, right: Multiaddr): boolean => {
  const [left_host, left_port] = left.getComponents()
  const [right_host, right_port] = right.getComponents()
  return left_host?.value === right_host?.value && left_port?.name === 'tcp' && left_port.value === right_port?.value
}

// The dials a mode refuses (§5.6.2, §5.6.3), and the own-peers relay's
// reservation rule (§5.6.3).
export const create_connection_gater = ({ mode, relay_address, relay_server }: NetworkConfig): ConnectionGater => {
  const gater: ConnectionGater = {}
  if (mode === 'relayed' && relay_address !== undefined) {
    const relay = multiaddr(relay_address)
    const relay_peer_id = relay.getComponents().findLast(({ name }) => name === 'p2p')?.value as string
    // Only the relay, and peers through it: no public address, and no LAN
    // address a remote peer could steer the node into dialing.
    gater.denyDialMultiaddr = (address) => is_circuit(address)
      ? !through_relay(address, relay_peer_id)
      : !same_host_and_port(address, relay)
  }
  if (mode === 'masked') {
    // Tor exits cannot reach private addresses, and asking one to is a leak.
    gater.denyDialMultiaddr = (address) => {
      const direct = is_circuit(address) ? multiaddr(address.toString().slice(0, address.toString().indexOf(CIRCUIT))) : address
      return isPrivate(direct) === true
    }
  }
  if (relay_server !== false && relay_server.allowed_peer_ids.length > 0) {
    const allowed = new Set(relay_server.allowed_peer_ids)
    gater.denyInboundRelayReservation = (peer: PeerId) => !allowed.has(peer.toString())
  }
  return gater
}

const transports_for = (config: NetworkConfig) => {
  if (config.mode === 'masked') {
    // Client-only relay transport: it dials relayed peers, its hop dial going
    // through Tor, and never reserves since nothing listens on /p2p-circuit.
    return [tor_transport({ socks_address: (config.tor as { socks_address: string }).socks_address }), circuitRelayTransport()]
  }
  return [tcp(), circuitRelayTransport()]
}

const addresses_for = ({ mode, listen, announce_addresses, relay_address }: NetworkConfig): NonNullable<Libp2pOptions['addresses']> => {
  if (mode === 'masked') return { listen: [] }
  if (mode === 'relayed') {
    return {
      listen: [`${relay_address as string}${CIRCUIT}`],
      announceFilter: (addresses) => addresses.filter(is_circuit)
    }
  }
  // A bare /p2p-circuit reserves on a discovered relay while the node is not
  // itself reachable; a node whose operator vouches for its address skips it.
  if (announce_addresses.length > 0) return { listen: [...listen], announce: [...announce_addresses] }
  return { listen: [...listen, CIRCUIT] }
}

// A DNS client that refuses every query. libp2p resolves /dnsaddr addresses
// with it before the connection gater sees them, so in masked and relayed
// modes a peer could otherwise make the node query the local resolver for a
// name of the peer's choosing.
const NO_DNS = { query: async () => { throw new Error('this network mode does no DNS lookups') } }

// A Tor circuit often takes longer to open than libp2p's 6 s per address.
const MASKED_DIAL_TIMEOUT_MS = 60_000

const connection_manager_for = (mode: NetworkMode): NonNullable<Libp2pOptions['connectionManager']> => {
  if (mode === 'public') return {}
  return {
    resolvers: {},
    ...(mode === 'masked' ? { dialTimeout: MASKED_DIAL_TIMEOUT_MS, addressDialTimeout: MASKED_DIAL_TIMEOUT_MS } : {})
  }
}

export const create_libp2p_options = (config: NetworkConfig): Libp2pOptions<RecordServices> => {
  const { mode, bootstrap: bootstrap_list, mdns: use_mdns, dht, upnp, mainline_rendezvous: rendezvous, relay_server } = config
  const is_public = mode === 'public'
  return {
    connectionManager: connection_manager_for(mode),
    ...(is_public ? {} : { dns: NO_DNS as unknown as NonNullable<Libp2pOptions['dns']> }),
    addresses: addresses_for(config),
    transports: transports_for(config),
    connectionEncrypters: [noise(NOISE_INIT)],
    streamMuxers: [yamux()],
    connectionProtector: preSharedKey({ psk: utf8ToBytes(RECORD_SWARM_KEY) }),
    connectionGater: create_connection_gater(config),
    nodeInfo: { name: 'record-node', version: VERSION, userAgent: agent_string(mode) },
    peerDiscovery: [
      ...(bootstrap_list.length > 0 ? [bootstrap({ list: [...bootstrap_list] })] : []),
      ...(use_mdns ? [mdns()] : [])
    ],
    services: {
      identify: identify(),
      // Tells connected peers when this node's addresses or protocols change:
      // a relay reservation's circuit address, a DHT turning server.
      identify_push: identifyPush(),
      ping: ping(),
      // Heads go out on a peer join, before the mesh has formed, so publishing
      // floods to every subscriber and never fails for want of one.
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, floodPublish: true }),
      // A private network's peers are reachable on local addresses too, except
      // to a masked node, which may only dial through Tor. A relayed node
      // starts as a client and serves once it has its circuit address.
      ...(dht
        ? {
            dht: kadDHT({
              clientMode: mode !== 'public',
              peerInfoMapper: mode === 'masked' ? removePrivateAddressesMapper : passthroughMapper
            })
          }
        : {}),
      ...(is_public ? { autonat: autoNAT(), dcutr: dcutr() } : {}),
      ...(is_public && upnp ? { upnp: uPnPNAT({ autoConfirmAddress: true }) } : {}),
      ...(relay_server !== false
        ? { relay: circuitRelayServer({ reservations: { applyDefaultLimit: relay_server.allowed_peer_ids.length === 0 } }) }
        : {}),
      ...(rendezvous !== false ? { mainline_rendezvous: mainline_rendezvous(rendezvous) } : {})
    }
  } as Libp2pOptions<RecordServices>
}

// Dials each discovered peer, since libp2p only records discoveries.
const dial_discovered = (libp2p: RecordLibp2p) => {
  libp2p.addEventListener('peer:discovery', ({ detail }: CustomEvent<PeerInfo>) => {
    if (libp2p.getConnections(detail.id).length > 0) return
    libp2p.dial(detail.id).catch(() => {})
  })
}

// A relayed node's DHT turns server once its reservation gives it a circuit
// address. A peer adds a DHT server to its routing table when identify first
// shows the DHT protocol, taking the addresses it holds then; served from the
// start, the relay would see the protocol before the circuit address exists
// and never list the node, which leaves it unfindable by peer id (§5.6.3).
const serve_dht_once_reachable = (libp2p: RecordLibp2p) => {
  const dht = libp2p.services.dht as { getMode: () => string, setMode: (mode: 'server') => Promise<void> } | undefined
  if (dht === undefined) return
  const on_update = () => {
    if (dht.getMode() === 'server' || !libp2p.getMultiaddrs().some(is_circuit)) return
    libp2p.removeEventListener('self:peer:update', on_update)
    dht.setMode('server').catch(() => {})
  }
  libp2p.addEventListener('self:peer:update', on_update)
  on_update()
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
  if (network.mode === 'relayed') serve_dht_once_reachable(helia.libp2p)
  return helia
}
