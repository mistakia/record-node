// Node configuration for the process entry point: a JSON file named by
// --config or RECORD_CONFIG, under flag overrides, over the defaults.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_PEER_CONFIG, resolve_peer_config, type PeerConfig } from '#peer/config.ts'

export const DEFAULT_PORT = 3000
export const DEFAULT_HOST = '127.0.0.1'
export const default_data_dir = (): string => join(homedir(), '.record')

export interface NodeConfig {
  readonly port: number
  readonly host: string
  readonly peer: PeerConfig
}

const FILE_KEYS = new Set(['port', 'host', 'data_dir', 'ytdlp_path', ...Object.keys(DEFAULT_PEER_CONFIG)])

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

export const load_config = async ({ config_path, port, data_dir, env = process.env }: {
  config_path?: string | undefined
  port?: string | number | undefined
  data_dir?: string | undefined
  env?: Record<string, string | undefined>
} = {}): Promise<NodeConfig> => {
  const path = config_path ?? env.RECORD_CONFIG
  const { port: file_port, host, ...peer } = path === undefined ? {} : await read_config_file(path)
  return {
    port: port_of(port ?? file_port ?? DEFAULT_PORT),
    host: typeof host === 'string' ? host : DEFAULT_HOST,
    peer: resolve_peer_config({ ...peer, data_dir: data_dir ?? (peer.data_dir as string | undefined) ?? default_data_dir() } as Partial<PeerConfig>)
  }
}
