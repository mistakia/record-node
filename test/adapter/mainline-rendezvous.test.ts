// The §5.2.1 mainline rendezvous on a loopback DHT: what a node announces,
// and that a node finding an announced address dials it and replicates.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_rendezvous, type Rendezvous } from 'bitboot'
import { defaultLogger } from '@libp2p/logger'
import { multiaddr } from '@multiformats/multiaddr'

import { RENDEZVOUS_NAME } from '#adapter/libp2p/config.ts'
import { confirmed_public_port, mainline_rendezvous } from '#adapter/libp2p/mainline-rendezvous.ts'
import { compute_track_id } from '#entry/id.ts'
import { create_libp2p_peers, dial_address, start_local_dht } from '#test/helpers/libp2p.ts'
import { append_track, wait_for_event, wait_until } from '#test/helpers/network.ts'

const address = (text: string, verified: boolean) => ({ multiaddr: multiaddr(text), verified })

const cleanups: Array<() => Promise<void>> = []
const peers = create_libp2p_peers()
afterEach(async () => {
  await peers.stop_all()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const start_observer = async (dht_address: string): Promise<Rendezvous> => {
  const observer = create_rendezvous({ name: RENDEZVOUS_NAME, dht_bootstrap: [dht_address] })
  await observer.start()
  cleanups.push(async () => { await observer.stop() })
  return observer
}

describe('confirmed_public_port', () => {
  test('takes a verified public IPv4 TCP address only', () => {
    expect(confirmed_public_port([])).toBeNull()
    expect(confirmed_public_port([address('/ip4/192.168.1.5/tcp/4100', true), address('/ip4/127.0.0.1/tcp/4100', true)])).toBeNull()
    expect(confirmed_public_port([address('/ip4/178.18.253.104/tcp/4100', false)])).toBeNull()
    expect(confirmed_public_port([address('/ip4/178.18.253.104/tcp/4100/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5/p2p-circuit', true)])).toBeNull()
    expect(confirmed_public_port([address('/ip4/10.0.0.2/tcp/1', true), address('/ip4/178.18.253.104/tcp/4100/p2p/12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5', true)])).toBe(4100)
  })
})

describe('mainline rendezvous service', () => {
  test('announces nothing until an address is confirmed public, then announces its port', async () => {
    const dht = await start_local_dht()
    cleanups.push(dht.stop)
    const addresses = [address('/ip4/127.0.0.1/tcp/4100', true), address('/ip4/178.18.253.104/tcp/4100', false)]
    const events = new EventTarget()
    const service = mainline_rendezvous({ dht_bootstrap: [dht.address], port: 0, lookup_interval_ms: 60_000 })({
      addressManager: { getAddressesWithMetadata: () => addresses },
      connectionManager: { openConnection: async () => undefined, getConnections: () => [] },
      events,
      logger: defaultLogger()
    })
    service.start()
    cleanups.push(async () => { await service.stop() })
    const observer = await start_observer(dht.address)

    expect(service.announced_port()).toBeNull()
    expect(await observer.lookup()).toEqual([])

    // AutoNAT confirms the public address.
    addresses[1] = address('/ip4/178.18.253.104/tcp/4100', true)
    events.dispatchEvent(new CustomEvent('self:peer:update'))
    expect(service.announced_port()).toBe(4100)
    // The DHT stores the announce's UDP source, loopback here, with the port.
    await wait_until(async () => (await observer.lookup()).some(({ port }) => port === 4100))
  })

  test('a node dials an address it finds and replicates the library there', async () => {
    const dht = await start_local_dht()
    cleanups.push(dht.stop)
    const a = await peers.start()
    await append_track({ peer: a, fingerprint: 'AQADtEmSaImS' })
    // a's announcement, as a reachable node's rendezvous would make it.
    const announcer = await start_observer(dht.address)
    await announcer.announce(Number(multiaddr(await dial_address(a)).getComponents()[1]?.value))

    const b = await peers.start({ mainline_rendezvous: { dht_bootstrap: [dht.address], port: 0, lookup_interval_ms: 60_000 } })
    const a_address = a.identity().own_address
    await wait_until(async () => (await b.list_peers()).some(({ peer_id }) => peer_id === a.context.store.network?.peer_id), 15_000)
    const b_has_a = wait_for_event(b, (event) => event.type === 'track:added' && event.payload.library_address === a_address)
    await b.link_library({ address: a_address, alias: null })
    await b_has_a
    const items = (await b.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc', library_addresses: [a_address] })).items
    expect(items.map(({ id }) => id)).toEqual([compute_track_id('AQADtEmSaImS')])
  })
})
