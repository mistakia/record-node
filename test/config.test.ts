// Process configuration: file, flag overrides, and defaults (src/config.ts).

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_PORT, default_data_dir, load_config } from '../src/config.ts'

const config_file = (value: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'record-config-')), 'config.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

describe('config', () => {
  test('defaults to port 3000, loopback, ~/.record, and the protocol floors', async () => {
    const config = await load_config({ env: {} })
    expect(config).toMatchObject({ port: DEFAULT_PORT, host: '127.0.0.1' })
    expect(config.peer).toMatchObject({ data_dir: default_data_dir(), traversal_concurrency: 4, traversal_timeout_ms: 30_000, heads_interval_ms: 1000 })
  })

  test('flags override the file named by RECORD_CONFIG', async () => {
    const path = config_file({ port: 4000, data_dir: '/from/file', ffmpeg_path: '/opt/ffmpeg' })
    expect(await load_config({ env: { RECORD_CONFIG: path } })).toMatchObject({ port: 4000, peer: { data_dir: '/from/file', ffmpeg_path: '/opt/ffmpeg' } })
    expect(await load_config({ env: { RECORD_CONFIG: path }, port: '5000', data_dir: '/from/flag' }))
      .toMatchObject({ port: 5000, peer: { data_dir: '/from/flag', ffmpeg_path: '/opt/ffmpeg' } })
  })

  test('refuses unknown keys and out-of-range values', async () => {
    await expect(load_config({ config_path: config_file({ prot: 1 }) })).rejects.toThrow('unknown keys: prot')
    await expect(load_config({ config_path: config_file({ traversal_concurrency: 0 }) })).rejects.toThrow('traversal_concurrency')
    await expect(load_config({ env: {}, port: 'eighty' })).rejects.toThrow('port must be')
    // A string is never a boolean: "false" must not unpin the toolchain.
    await expect(load_config({ config_path: config_file({ allow_toolchain_mismatch: 'false' }) })).rejects.toThrow('allow_toolchain_mismatch')
    await expect(load_config({ config_path: config_file({ ffmpeg_path: 7 }) })).rejects.toThrow('ffmpeg_path')
  })

  test('reads cors_origins, and refuses anything but an array of strings', async () => {
    expect((await load_config({ env: {} })).cors_origins).toBeUndefined()
    expect((await load_config({ config_path: config_file({ cors_origins: [] }) })).cors_origins).toEqual([])
    expect((await load_config({ config_path: config_file({ cors_origins: ['app://record'] }) })).cors_origins).toEqual(['app://record'])
    await expect(load_config({ config_path: config_file({ cors_origins: 'app://record' }) })).rejects.toThrow('cors_origins')
    await expect(load_config({ config_path: config_file({ cors_origins: [1] }) })).rejects.toThrow('cors_origins')
    await expect(load_config({ config_path: config_file({ cors_origins: ['null'] }) })).rejects.toThrow('origin null')
  })

  test('refuses heads and announcement intervals below the §5.4.1 and §5.3.3 floors', async () => {
    await expect(load_config({ config_path: config_file({ heads_interval_ms: 999 }) })).rejects.toThrow('heads_interval_ms must be at least 1000')
    await expect(load_config({ config_path: config_file({ announce_interval_ms: 4999 }) })).rejects.toThrow('announce_interval_ms must be at least 5000')
    await expect(load_config({ config_path: config_file({ audio_cache_max_bytes: 0 }) })).rejects.toThrow('audio_cache_max_bytes')
    await expect(load_config({ config_path: config_file({ audio_fetch_timeout_ms: 'soon' }) })).rejects.toThrow('audio_fetch_timeout_ms')
  })

  test('fills a partial network config from the §5.5.1 defaults, or turns the network off', async () => {
    const { peer } = await load_config({ config_path: config_file({ network: { mdns: false, bootstrap: ['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooW'] } }) })
    expect(peer.network).toEqual({ listen: ['/ip4/0.0.0.0/tcp/0'], bootstrap: ['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooW'], mdns: false, dht: true })
    expect((await load_config({ config_path: config_file({ network: false }) })).peer.network).toBe(false)
    await expect(load_config({ config_path: config_file({ network: { mdns: 'yes' } }) })).rejects.toThrow('network.mdns')
    await expect(load_config({ config_path: config_file({ network: { listen: '/ip4/0.0.0.0/tcp/0' } }) })).rejects.toThrow('network.listen')
    await expect(load_config({ config_path: config_file({ network: { psk: 'x' } }) })).rejects.toThrow('network has unknown keys: psk')
  })
})
