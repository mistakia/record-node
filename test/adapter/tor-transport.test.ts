// The §5.6.2 masked mode over a loopback SOCKS5 proxy standing in for Tor:
// every dial goes through the proxy, a hostname reaches it unresolved, and
// the node listens on and advertises nothing. With TOR_SOCKS_ADDRESS and
// RECORD_TOR_TEST_BOOTSTRAP set, one more test joins a real network through
// a real Tor.

import { afterEach, describe, expect, test } from 'bun:test'
import { Resolver } from 'node:dns/promises'
import { connect, createServer, type Server, type Socket } from 'node:net'

import { multiaddr } from '@multiformats/multiaddr'

import { socks_destination } from '#adapter/libp2p/tor-transport.ts'
import { compute_track_id } from '#entry/id.ts'
import { create_libp2p_peers, dial_address, libp2p_of } from '#test/helpers/libp2p.ts'
import { append_track, wait_for_event, wait_until } from '#test/helpers/network.ts'

const TEST_HOST = 'record-test.invalid'

interface SocksRequest { readonly host: string, readonly port: number, readonly address_type: number, readonly username: string | null }

// A SOCKS5 CONNECT proxy taking any username and password, as Tor does to
// isolate streams. It resolves only TEST_HOST, to loopback, and refuses every
// other destination after recording it.
const start_socks_proxy = async (): Promise<{ address: string, requests: SocksRequest[], close: () => Promise<void> }> => {
  const requests: SocksRequest[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    const on_request = (username: string | null) => (request: Buffer) => {
      const address_type = request[3] as number
      let host: string
      let offset: number
      if (address_type === 3) {
        const length = request[4] as number
        host = request.subarray(5, 5 + length).toString('ascii')
        offset = 5 + length
      } else if (address_type === 1) {
        host = [...request.subarray(4, 8)].join('.')
        offset = 8
      } else {
        return client.destroy()
      }
      const port = request.readUInt16BE(offset)
      requests.push({ host, port, address_type, username })
      if (host !== TEST_HOST) {
        client.end(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const upstream = connect(port, '127.0.0.1', () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        client.pipe(upstream).pipe(client)
      })
      sockets.add(upstream)
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream.destroy())
    }
    client.once('data', (greeting: Buffer) => {
      if (greeting[0] !== 5) return client.destroy()
      const methods = [...greeting.subarray(2, 2 + (greeting[1] as number))]
      if (!methods.includes(2)) {
        client.write(Buffer.from([5, 0]))
        client.once('data', on_request(null))
        return
      }
      client.write(Buffer.from([5, 2]))
      client.once('data', (auth: Buffer) => {
        const username = auth.subarray(2, 2 + (auth[1] as number)).toString('utf8')
        client.write(Buffer.from([1, 0]))
        client.once('data', on_request(username))
      })
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const { port } = server.address() as { port: number }
  return {
    address: `127.0.0.1:${port}`,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  }
}

const peers = create_libp2p_peers()
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await peers.stop_all()
  for (const close of closers.splice(0)) await close()
})

const MASKED_FIXED = { mode: 'masked', listen: [], mdns: false, dht: false } as const

describe('socks_destination', () => {
  test('takes a direct TCP address, hostnames as they are', () => {
    expect(socks_destination(multiaddr('/dns4/example.org/tcp/4100/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5'))).toEqual({ host: 'example.org', port: 4100 })
    expect(socks_destination(multiaddr('/ip4/178.18.253.104/tcp/443'))).toEqual({ host: '178.18.253.104', port: 443 })
    expect(socks_destination(multiaddr('/ip6/2001:db8::1/tcp/4100'))).toEqual({ host: '2001:db8::1', port: 4100 })
    expect(socks_destination(multiaddr('/ip4/178.18.253.104/udp/4100/quic-v1'))).toBeUndefined()
    expect(socks_destination(multiaddr('/ip4/178.18.253.104/tcp/4100/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5/p2p-circuit'))).toBeUndefined()
  })
})

describe('masked mode', () => {
  test('dials through the proxy with the hostname unresolved, advertises nothing, and replicates', async () => {
    const proxy = await start_socks_proxy()
    closers.push(proxy.close)
    const a = await peers.start()
    await append_track({ peer: a, fingerprint: 'AQADtEmSaImS' })
    const a_address = multiaddr(await dial_address(a))
    const [, tcp, p2p] = a_address.getComponents()
    const bootstrap = `/dns4/${TEST_HOST}/tcp/${tcp?.value as string}/p2p/${p2p?.value as string}`

    const masked = await peers.start({ ...MASKED_FIXED, tor: { socks_address: proxy.address }, bootstrap: [bootstrap] })
    expect(await masked.get_settings()).toMatchObject({ addresses: [], network_mode: 'masked' })
    await wait_until(async () => (await masked.list_peers()).length > 0)
    // The hostname reaches the proxy unresolved, under its own credentials,
    // so Tor gives the destination its own circuit.
    expect(proxy.requests).toContainEqual({ host: TEST_HOST, port: Number(tcp?.value), address_type: 3, username: `${TEST_HOST}:${tcp?.value as string}` })

    const library = a.identity().own_address
    const replicated = wait_for_event(masked, (event) => event.type === 'track:added' && event.payload.library_address === library)
    await masked.link_library({ address: library, alias: null })
    await replicated
    const items = (await masked.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc', library_addresses: [library] })).items
    expect(items.map(({ id }) => id)).toEqual([compute_track_id('AQADtEmSaImS')])
  })

  test('refuses private addresses and sends every other dial to the proxy', async () => {
    const proxy = await start_socks_proxy()
    closers.push(proxy.close)
    const a = await peers.start()
    const masked = await peers.start({ ...MASKED_FIXED, tor: { socks_address: proxy.address }, bootstrap: [] })
    await expect(libp2p_of(masked).dial(multiaddr(await dial_address(a)))).rejects.toThrow()
    await expect(libp2p_of(masked).dial(multiaddr('/ip4/178.18.253.104/tcp/9/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5'))).rejects.toThrow()
    expect(proxy.requests).toEqual([{ host: '178.18.253.104', port: 9, address_type: 1, username: '178.18.253.104:9' }])
  })

  test('never asks the local resolver about a /dnsaddr address, where a public node does', async () => {
    const queried: string[] = []
    const original = Resolver.prototype.resolveTxt
    Resolver.prototype.resolveTxt = async function (hostname: string) {
      queried.push(hostname)
      return []
    }
    closers.push(async () => { Resolver.prototype.resolveTxt = original })
    const proxy = await start_socks_proxy()
    closers.push(proxy.close)
    const target = multiaddr('/dnsaddr/attacker.invalid/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5')

    const masked = await peers.start({ ...MASKED_FIXED, tor: { socks_address: proxy.address }, bootstrap: [] })
    await expect(libp2p_of(masked).dial(target)).rejects.toThrow()
    expect(queried).toEqual([])

    // The control: the same dial from a public node does query, so the spy sees lookups.
    const open = await peers.start()
    await expect(libp2p_of(open).dial(target)).rejects.toThrow()
    expect(queried).toContain('_dnsaddr.attacker.invalid')
  })
})

const tor_socks_address = process.env.TOR_SOCKS_ADDRESS
const tor_bootstrap = process.env.RECORD_TOR_TEST_BOOTSTRAP
const tor_library = process.env.RECORD_TOR_TEST_LIBRARY

describe.skipIf(tor_socks_address === undefined || tor_bootstrap === undefined)('masked mode over Tor', () => {
  test('joins through the bootstrap node and replicates a library', async () => {
    const masked = await peers.start({ ...MASKED_FIXED, dht: true, tor: { socks_address: tor_socks_address as string }, bootstrap: [tor_bootstrap as string] })
    await wait_until(async () => (await masked.list_peers()).length > 0, 120_000)
    if (tor_library === undefined) return
    const replicated = wait_for_event(masked, (event) => event.type === 'track:added' && event.payload.library_address === tor_library, 300_000)
    await masked.link_library({ address: tor_library, alias: null })
    await replicated
  }, 600_000)
})
