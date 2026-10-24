// Node configuration for the process entry point: a JSON file named by
// --config or RECORD_CONFIG, under flag overrides, over the defaults.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parse_library_address } from '#encoding/library-address.ts'
import { DEFAULT_PEER_CONFIG, resolve_peer_config, type PeerConfig } from '#peer/config.ts'

export const DEFAULT_PORT = 3000
export const DEFAULT_HOST = '127.0.0.1'
export const default_data_dir = (): string => join(homedir(), '.record')

export interface RemoteListener {
  readonly host: string
  readonly port: number
}

export interface NodeConfig {
  readonly port: number
  readonly host: string
  // The origins a browser page may call the API from; unset means the
  // known-client default, which admits none.
  readonly cors_origins?: readonly string[] | undefined
  // A second address serving the same API that always requires a bearer
  // token from the token store, for a reverse proxy to expose; unset means
  // the node serves only the tokenless loopback listener.
  readonly remote_listener?: RemoteListener | undefined
  // Label libraries the node manages, each with the id of the one access
  // token allowed to write labels to it; every other caller, a tokenless
  // loopback one included, is refused (chapter 7).
  readonly managed_label_libraries: ReadonlyMap<string, string>
  readonly peer: PeerConfig
}

const FILE_KEYS = new Set(['port', 'host', 'cors_origins', 'remote_listener', 'managed_label_libraries', 'data_dir', 'index_dir', 'ytdlp_path', ...Object.keys(DEFAULT_PEER_CONFIG)])

const read_config_file = async (path: string): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must hold a JSON object`)
  const unknown = Object.keys(value).filter((key) => !FILE_KEYS.has(key))
  if (unknown.length > 0) throw new TypeError(`${path} has unknown keys: ${unknown.join(', ')}`)
  return value as Record<string, unknown>
}

const port_of = (value: unknown): number => {
  const port = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(port) || (port as number) < 0 || (port as number) > 65535) throw new RangeError(`port must be 0-65535, not ${String(value)}`)
  return port as number
}

const cors_origins_of = (value: unknown): readonly string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((origin) => typeof origin === 'string')) throw new TypeError('cors_origins must be an array of origin strings')
  if (value.includes('null')) throw new TypeError('cors_origins may not allow the origin null')
  return Object.freeze([...value as string[]])
}

const remote_listener_of = (value: unknown): RemoteListener | undefined => {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('remote_listener must be an object of host and port')
  const { host, port, ...rest } = value as Record<string, unknown>
  const unknown = Object.keys(rest)
  if (unknown.length > 0) throw new TypeError(`remote_listener has unknown keys: ${unknown.join(', ')}`)
  if (typeof host !== 'string' || host === '') throw new TypeError('remote_listener.host must be a host string')
  if (typeof port !== 'number') throw new TypeError('remote_listener.port must be a number')
  return Object.freeze({ host, port: port_of(port) })
}

// { "<library address>": "<access-token id>" }, as `record-node token list` shows ids.
const managed_label_libraries_of = (value: unknown): ReadonlyMap<string, string> => {
  if (value === undefined) return new Map()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('managed_label_libraries must map library addresses to access-token ids')
  return new Map(Object.entries(value).map(([address, token_id]) => {
    try {
      parse_library_address(address)
    } catch {
      throw new TypeError(`managed_label_libraries names an invalid library address: ${address}`)
    }
    if (typeof token_id !== 'string' || !/^[0-9a-f]{12}$/.test(token_id)) throw new TypeError(`managed_label_libraries[${address}] must be an access-token id`)
    return [address, token_id]
  }))
}

export const load_config = async ({ config_path, port, data_dir, env = process.env }: {
  config_path?: string | undefined
  port?: string | number | undefined
  data_dir?: string | undefined
  env?: Record<string, string | undefined>
} = {}): Promise<NodeConfig> => {
  const path = config_path ?? env.RECORD_CONFIG
  const { port: file_port, host, cors_origins, remote_listener, managed_label_libraries, ...peer } = path === undefined ? {} : await read_config_file(path)
  return {
    port: port_of(port ?? file_port ?? DEFAULT_PORT),
    host: typeof host === 'string' ? host : DEFAULT_HOST,
    cors_origins: cors_origins_of(cors_origins),
    remote_listener: remote_listener_of(remote_listener),
    managed_label_libraries: managed_label_libraries_of(managed_label_libraries),
    peer: resolve_peer_config({ ...peer, data_dir: data_dir ?? (peer.data_dir as string | undefined) ?? default_data_dir() } as Partial<PeerConfig>)
  }
}
