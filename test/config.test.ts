// Process configuration: file, flag overrides, and defaults (src/config.ts).

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { publicKeyFromProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPublicKey } from '@libp2p/peer-id'

import { DEFAULT_MASKED_BOOTSTRAP, VPS_PEER_ID } from '../src/adapter/libp2p/config.ts'
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
    expect(peer.network).toEqual({
      mode: 'public',
      listen: ['/ip4/0.0.0.0/tcp/0'],
      announce_addresses: [],
      bootstrap: ['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooW'],
      mdns: false,
      dht: true,
      upnp: true,
      mainline_rendezvous: { port: 0, lookup_interval_ms: 900_000 },
      relay_server: { allowed_peer_ids: [] }
    })
    expect((await load_config({ config_path: config_file({ network: false }) })).peer.network).toBe(false)
    await expect(load_config({ config_path: config_file({ network: { mdns: 'yes' } }) })).rejects.toThrow('network.mdns')
    await expect(load_config({ config_path: config_file({ network: { listen: '/ip4/0.0.0.0/tcp/0' } }) })).rejects.toThrow('network.listen')
    await expect(load_config({ config_path: config_file({ network: { psk: 'x' } }) })).rejects.toThrow('network has unknown keys: psk')
  })

  test('census is off by default, a boolean, and needs a network', async () => {
    expect((await load_config({ env: {} })).peer.census).toBe(false)
    expect((await load_config({ config_path: config_file({ census: true }) })).peer.census).toBe(true)
    await expect(load_config({ config_path: config_file({ census: 'yes' }) })).rejects.toThrow('census must be true or false')
    await expect(load_config({ config_path: config_file({ census: true, network: false }) })).rejects.toThrow('census needs a network')
  })
})

describe('network modes (spec §5.6)', () => {
  const network_of = async (network: unknown) => (await load_config({ config_path: config_file({ network }) })).peer.network
  const refuses = async (network: unknown, message: string) => {
    await expect(load_config({ config_path: config_file({ network }) })).rejects.toThrow(message)
  }
  const RELAY = '/ip4/178.18.253.104/tcp/4100/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5'

  test('public keys: rendezvous port, announce addresses, the own-peers relay', async () => {
    expect(await network_of({ mainline_rendezvous: { port: 4100 }, announce_addresses: ['/ip4/178.18.253.104/tcp/4100'], relay_server: { allowed_peer_ids: ['12D3KooWcanonical'] } })).toMatchObject({
      mode: 'public',
      mainline_rendezvous: { port: 4100, lookup_interval_ms: 900_000 },
      announce_addresses: ['/ip4/178.18.253.104/tcp/4100'],
      relay_server: { allowed_peer_ids: ['12D3KooWcanonical'] }
    })
    expect(await network_of({ mainline_rendezvous: false, relay_server: false, upnp: false })).toMatchObject({ mainline_rendezvous: false, relay_server: false, upnp: false })
    expect(await network_of({ mainline_rendezvous: true })).toMatchObject({ mainline_rendezvous: { port: 0 } })
    await refuses({ mainline_rendezvous: { port: 70000 } }, 'mainline_rendezvous.port')
    await refuses({ mainline_rendezvous: { dht_bootstrap: ['router.example'] } }, 'dht_bootstrap')
    await refuses({ mainline_rendezvous: { lookup_interval_ms: 1000 } }, 'lookup_interval_ms')
    await refuses({ mainline_rendezvous: { bitboot: true } }, 'mainline_rendezvous has unknown keys: bitboot')
    await refuses({ relay_server: { allowed_peer_ids: 'x' } }, 'allowed_peer_ids')
    await refuses({ upnp: 'on' }, 'network.upnp')
  })

  test('masked defaults: no listen, no LAN discovery, no rendezvous, the VPS bootstrap', async () => {
    expect(await network_of({ mode: 'masked', tor: { socks_address: '127.0.0.1:9050' } })).toEqual({
      mode: 'masked',
      listen: [],
      announce_addresses: [],
      bootstrap: [...DEFAULT_MASKED_BOOTSTRAP],
      mdns: false,
      dht: true,
      upnp: false,
      mainline_rendezvous: false,
      relay_server: false,
      tor: { socks_address: '127.0.0.1:9050' }
    })
  })

  test('masked refuses anything that would listen, advertise, or dial outside Tor', async () => {
    const tor = { socks_address: '127.0.0.1:9050' }
    await refuses({ mode: 'masked' }, 'network.tor is required in masked mode')
    await refuses({ mode: 'masked', tor, listen: ['/ip4/0.0.0.0/tcp/0'] }, 'network.listen cannot be set in masked mode')
    await refuses({ mode: 'masked', tor, announce_addresses: ['/ip4/1.2.3.4/tcp/1'] }, 'announce_addresses cannot be set')
    await refuses({ mode: 'masked', tor, mdns: true }, 'network.mdns cannot be set')
    await refuses({ mode: 'masked', tor, upnp: true }, 'network.upnp cannot be set')
    await refuses({ mode: 'masked', tor, mainline_rendezvous: true }, 'mainline_rendezvous cannot be set')
    await refuses({ mode: 'masked', tor, relay_server: true }, 'relay_server cannot be set')
    await refuses({ mode: 'masked', tor, relay_address: RELAY }, 'relay_address cannot be set')
    await refuses({ mode: 'masked', tor: { socks_address: '127.0.0.1' } }, 'socks_address must be a host:port')
    await refuses({ mode: 'masked', tor: { socks_address: '127.0.0.1:9050', isolate: true } }, 'network.tor has unknown keys')
    // Repeating the mode's own value is allowed.
    expect(await network_of({ mode: 'masked', tor, mdns: false, listen: [] })).toMatchObject({ mode: 'masked' })
  })

  test('relayed needs its relay and refuses LAN discovery, listening and NAT traversal', async () => {
    expect(await network_of({ mode: 'relayed', relay_address: RELAY })).toMatchObject({
      mode: 'relayed', relay_address: RELAY, listen: [], mdns: false, dht: true, upnp: false, mainline_rendezvous: false, relay_server: false
    })
    await refuses({ mode: 'relayed' }, 'network.relay_address is required in relayed mode')
    await refuses({ mode: 'relayed', relay_address: '/ip4/178.18.253.104/tcp/4100' }, 'relay_address must be a multiaddr ending in /p2p/')
    await refuses({ mode: 'relayed', relay_address: RELAY, mdns: true }, 'network.mdns cannot be set in relayed mode')
    await refuses({ mode: 'relayed', relay_address: RELAY, listen: ['/ip4/10.27.0.22/tcp/4100'] }, 'network.listen cannot be set')
    await refuses({ mode: 'relayed', relay_address: RELAY, mainline_rendezvous: true }, 'mainline_rendezvous cannot be set')
    await refuses({ mode: 'relayed', relay_address: RELAY, tor: { socks_address: '127.0.0.1:9050' } }, 'network.tor cannot be set')
  })

  test('public refuses a relay address or Tor, and unknown modes are refused', async () => {
    await refuses({ relay_address: RELAY }, 'network.relay_address cannot be set in public mode')
    await refuses({ tor: { socks_address: '127.0.0.1:9050' } }, 'network.tor cannot be set in public mode')
    await refuses({ mode: 'hidden' }, 'network.mode must be one of public, masked, relayed')
  })

  test('the masked bootstrap names the VPS node by the peer id of its key', () => {
    // The public half of credentials/signing/record-node-vps-peer-key.
    const public_key = publicKeyFromProtobuf(Buffer.from('CAESINfXgoHOqCYaazohe1vS6974lrKS3BtWCmAlA/BpNEnI', 'base64'))
    expect(peerIdFromPublicKey(public_key).toString()).toBe(VPS_PEER_ID)
    for (const address of DEFAULT_MASKED_BOOTSTRAP) expect(address).toEndWith(`/p2p/${VPS_PEER_ID}`)
  })
})
