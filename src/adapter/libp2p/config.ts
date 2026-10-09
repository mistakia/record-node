// The §5.5.1 network's configuration, apart from the libp2p modules it
// configures, so loading a peer config never loads libp2p. The §5.6 mode
// decides the defaults and which keys may be set at all.

import { isIP } from 'node:net'

export const NETWORK_MODES = ['public', 'masked', 'relayed'] as const
export type NetworkMode = typeof NETWORK_MODES[number]

// The §5.2.1 shared bootstrap service.
export interface MainlineRendezvousConfig {
  // Mainline DHT bootstrap nodes as host:port; absent, the public routers.
  readonly dht_bootstrap?: readonly string[] | undefined
  // UDP port the mainline DHT listens on; 0 picks a free one.
  readonly port: number
  // How often the rendezvous is looked up after the lookup at start.
  readonly lookup_interval_ms: number
}

export interface RelayServerConfig {
  // Empty: a circuit relay with the default limits, for hole-punch
  // coordination (§5.5.2). Set: reservations only for these peer ids, with
  // the limits lifted so their content flows over the relay (§5.6.3).
  readonly allowed_peer_ids: readonly string[]
}

export interface TorConfig {
  // Tor's SOCKS5 listener as host:port.
  readonly socks_address: string
}

export interface NetworkConfig {
  readonly mode: NetworkMode
  // Multiaddrs to listen on. A relayed node listens on its relay's circuit
  // and a masked node on nothing, so neither may set this.
  readonly listen: readonly string[]
  // Public addresses the operator vouches are reachable. They replace the
  // advertised addresses and count as confirmed for the rendezvous, which
  // AutoNAT cannot do for the network's first node (public only).
  readonly announce_addresses: readonly string[]
  // The shared bootstrap service: multiaddrs with a /p2p/ peer id.
  readonly bootstrap: readonly string[]
  // Local-network discovery.
  readonly mdns: boolean
  // Content-network native discovery: the libp2p Kademlia DHT, as a client
  // in masked mode and a server otherwise.
  readonly dht: boolean
  // UPnP port mapping on the local gateway (public only).
  readonly upnp: boolean
  readonly mainline_rendezvous: MainlineRendezvousConfig | false
  readonly relay_server: RelayServerConfig | false
  // The relay a relayed node reserves on: a multiaddr ending /p2p/<peer id>.
  readonly relay_address?: string | undefined
  readonly tor?: TorConfig | undefined
}

// sha1 of this name is the §5.2.1 info hash.
export const RENDEZVOUS_NAME = 'record-network-v1'

export const DEFAULT_MAINLINE_RENDEZVOUS: MainlineRendezvousConfig = Object.freeze({
  port: 0,
  lookup_interval_ms: 15 * 60_000
})

// The public node on the nano-community VPS: a masked node cannot use the
// UDP mainline DHT, so it bootstraps here through Tor (§5.6.2). Port 443 is
// for Tor exits whose policy refuses 4100.
export const VPS_PEER_ID = '12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5'
export const DEFAULT_MASKED_BOOTSTRAP: readonly string[] = Object.freeze([
  `/ip4/178.18.253.104/tcp/4100/p2p/${VPS_PEER_ID}`,
  `/ip4/178.18.253.104/tcp/443/p2p/${VPS_PEER_ID}`
])

const MODE_DEFAULTS: Record<NetworkMode, NetworkConfig> = {
  public: Object.freeze({
    mode: 'public',
    listen: Object.freeze(['/ip4/0.0.0.0/tcp/0']),
    announce_addresses: Object.freeze([]),
    bootstrap: Object.freeze([]),
    mdns: true,
    dht: true,
    upnp: true,
    mainline_rendezvous: DEFAULT_MAINLINE_RENDEZVOUS,
    relay_server: Object.freeze({ allowed_peer_ids: Object.freeze([]) })
  }),
  masked: Object.freeze({
    mode: 'masked',
    listen: Object.freeze([]),
    announce_addresses: Object.freeze([]),
    bootstrap: DEFAULT_MASKED_BOOTSTRAP,
    mdns: false,
    dht: true,
    upnp: false,
    mainline_rendezvous: false,
    relay_server: false
  }),
  relayed: Object.freeze({
    mode: 'relayed',
    listen: Object.freeze([]),
    announce_addresses: Object.freeze([]),
    bootstrap: Object.freeze([]),
    mdns: false,
    dht: true,
    upnp: false,
    mainline_rendezvous: false,
    relay_server: false
  })
}

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = MODE_DEFAULTS.public

const KNOWN_KEYS = new Set(['mode', 'listen', 'announce_addresses', 'bootstrap', 'mdns', 'dht', 'upnp', 'mainline_rendezvous', 'relay_server', 'relay_address', 'tor'])

// Keys a mode fixes: setting one to anything but the mode's value is refused,
// since it would advertise or dial what the mode promises not to (§5.6).
const FIXED_BY_MODE: Record<NetworkMode, ReadonlyArray<keyof NetworkConfig>> = {
  public: ['relay_address', 'tor'],
  masked: ['listen', 'announce_addresses', 'mdns', 'upnp', 'mainline_rendezvous', 'relay_server', 'relay_address'],
  relayed: ['listen', 'announce_addresses', 'mdns', 'upnp', 'mainline_rendezvous', 'relay_server', 'tor']
}

const is_string_list = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const is_object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const is_port = (value: unknown, { allow_zero }: { allow_zero: boolean }): value is number =>
  Number.isSafeInteger(value) && (value as number) >= (allow_zero ? 0 : 1) && (value as number) <= 65535

// host:port with an IP or hostname host; IPv6 in brackets.
export const parse_host_port = (value: string): { host: string, port: number } | undefined => {
  const match = /^(?:\[([0-9a-fA-F:.]+)\]|([^:[\]]+)):(\d+)$/.exec(value)
  if (match === null) return undefined
  const host = (match[1] ?? match[2]) as string
  const port = Number(match[3])
  if (!is_port(port, { allow_zero: false })) return undefined
  if (match[1] !== undefined && isIP(host) !== 6) return undefined
  return { host, port }
}

const resolve_mainline_rendezvous = (value: unknown): MainlineRendezvousConfig | false => {
  if (value === false) return false
  if (value === true) return DEFAULT_MAINLINE_RENDEZVOUS
  if (!is_object(value)) throw new TypeError('network.mainline_rendezvous must be true, false, or an object')
  const resolved = { ...DEFAULT_MAINLINE_RENDEZVOUS, ...value } as Record<string, unknown>
  const unknown = Object.keys(resolved).filter((key) => !['dht_bootstrap', 'port', 'lookup_interval_ms'].includes(key))
  if (unknown.length > 0) throw new TypeError(`network.mainline_rendezvous has unknown keys: ${unknown.join(', ')}`)
  if (resolved.dht_bootstrap !== undefined && !(is_string_list(resolved.dht_bootstrap) && resolved.dht_bootstrap.every((entry) => parse_host_port(entry) !== undefined))) {
    throw new TypeError('network.mainline_rendezvous.dht_bootstrap must be an array of host:port strings')
  }
  if (!is_port(resolved.port, { allow_zero: true })) throw new RangeError('network.mainline_rendezvous.port must be 0-65535')
  if (!Number.isSafeInteger(resolved.lookup_interval_ms) || (resolved.lookup_interval_ms as number) < 60_000) {
    throw new RangeError('network.mainline_rendezvous.lookup_interval_ms must be an integer of at least 60000')
  }
  return Object.freeze(resolved) as unknown as MainlineRendezvousConfig
}

const resolve_relay_server = (value: unknown): RelayServerConfig | false => {
  if (value === false) return false
  if (value === true) return MODE_DEFAULTS.public.relay_server
  if (!is_object(value)) throw new TypeError('network.relay_server must be true, false, or an object')
  const unknown = Object.keys(value).filter((key) => key !== 'allowed_peer_ids')
  if (unknown.length > 0) throw new TypeError(`network.relay_server has unknown keys: ${unknown.join(', ')}`)
  const allowed = value.allowed_peer_ids ?? []
  if (!is_string_list(allowed) || allowed.some((peer_id) => peer_id === '')) throw new TypeError('network.relay_server.allowed_peer_ids must be an array of peer ids')
  return Object.freeze({ allowed_peer_ids: Object.freeze([...allowed]) })
}

const resolve_tor = (value: unknown): TorConfig | undefined => {
  if (value === undefined) return undefined
  if (!is_object(value)) throw new TypeError('network.tor must be an object')
  const unknown = Object.keys(value).filter((key) => key !== 'socks_address')
  if (unknown.length > 0) throw new TypeError(`network.tor has unknown keys: ${unknown.join(', ')}`)
  if (typeof value.socks_address !== 'string' || parse_host_port(value.socks_address) === undefined) {
    throw new TypeError('network.tor.socks_address must be a host:port string')
  }
  return Object.freeze({ socks_address: value.socks_address })
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

// A partial network object fills in from its mode's defaults; a key the mode
// fixes may be left out or repeat the mode's value, nothing else.
export const resolve_network_config = (network: unknown): NetworkConfig | false => {
  if (network === false) return false
  if (!is_object(network)) throw new TypeError('network must be false or an object')
  const unknown = Object.keys(network).filter((key) => !KNOWN_KEYS.has(key))
  if (unknown.length > 0) throw new TypeError(`network has unknown keys: ${unknown.join(', ')}`)
  const mode = network.mode ?? 'public'
  if (!NETWORK_MODES.includes(mode as NetworkMode)) throw new TypeError(`network.mode must be one of ${NETWORK_MODES.join(', ')}`)
  const defaults = MODE_DEFAULTS[mode as NetworkMode]
  const resolved = { ...defaults, ...network } as Record<string, unknown>
  for (const field of ['listen', 'announce_addresses', 'bootstrap'] as const) {
    if (!is_string_list(resolved[field])) throw new TypeError(`network.${field} must be an array of multiaddr strings`)
  }
  for (const field of ['mdns', 'dht', 'upnp'] as const) {
    if (typeof resolved[field] !== 'boolean') throw new TypeError(`network.${field} must be true or false`)
  }
  resolved.mainline_rendezvous = resolve_mainline_rendezvous(resolved.mainline_rendezvous)
  resolved.relay_server = resolve_relay_server(resolved.relay_server)
  resolved.tor = resolve_tor(resolved.tor)
  if (resolved.relay_address !== undefined && (typeof resolved.relay_address !== 'string' || !/\/p2p\/[^/]+$/.test(resolved.relay_address))) {
    throw new TypeError('network.relay_address must be a multiaddr ending in /p2p/<relay peer id>')
  }
  for (const field of FIXED_BY_MODE[mode as NetworkMode]) {
    if (field in network && !same(resolved[field], defaults[field])) throw new TypeError(`network.${field} cannot be set in ${String(mode)} mode`)
  }
  if (mode === 'masked' && resolved.tor === undefined) throw new TypeError('network.tor is required in masked mode')
  if (mode === 'relayed' && resolved.relay_address === undefined) throw new TypeError('network.relay_address is required in relayed mode')
  if (resolved.tor === undefined) delete resolved.tor
  if (resolved.relay_address === undefined) delete resolved.relay_address
  return Object.freeze(resolved) as unknown as NetworkConfig
}
