// The network census on a driven clock: counts across a UTC day and a
// Monday-to-Sunday week, the version floor, pruning, and that nothing it
// writes names a peer, an address, or a library.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { create_census, parse_agent, week_start, type CensusTimers } from '#peer/census.ts'
import { create_libp2p_peers, dial_address } from '#test/helpers/libp2p.ts'
import { wait_until } from '#test/helpers/network.ts'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
// Saturday 2026-10-10, 12:00 UTC.
const SATURDAY_NOON = Date.UTC(2026, 9, 10, 12)

const PEER_A = '12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5'
const PEER_B = '12D3KooWG5KsCz1aVrRbHHdTeFvN3s5DXGMvjM1tL4bUhAGxYaFi'
const PEER_C = '12D3KooWJovHaPHHi9UFFhWEQEUF9uQ2X4WqpT6uK41xLRC4M5D4'
const PEER_D = '12D3KooWBYM2PrcTGquiRbiGhxJQPpafrjfLXe2mMQTQ9ea7xMct'
const LIBRARY = '/record/zdpuAvXDqAUVNudhvp2JHZsfKDpHxmZGg3T1uAfKm3dHmwZUu/recordstore/record'

const fake_census = () => {
  const dir = mkdtempSync(join(tmpdir(), 'record-census-'))
  let now = SATURDAY_NOON
  let connected = 0
  const listeners = { open: [] as Array<(peer_id: string) => void>, identify: [] as Array<(peer_id: string, agent: string | undefined) => void>, library: [] as Array<(address: string) => void> }
  const subscribe = <T>(list: T[], listener: T) => {
    list.push(listener)
    return () => { list.splice(list.indexOf(listener), 1) }
  }
  const timers: CensusTimers = { now: () => now, set_interval: () => 0, clear_interval: () => {} }
  const census = create_census({
    dir,
    timers,
    observations: {
      on_connection_open: (listener) => subscribe(listeners.open, listener),
      on_peer_identify: (listener) => subscribe(listeners.identify, listener),
      on_library_announced: (listener) => subscribe(listeners.library, listener),
      connected_peer_count: () => connected,
      count_rendezvous_addresses: async () => 7
    }
  })
  return {
    dir,
    census,
    advance: (ms: number) => { now += ms },
    set_connected: (count: number) => { connected = count },
    connect: (peer_id: string, agent?: string) => {
      for (const listener of listeners.open) listener(peer_id)
      if (agent !== undefined) for (const listener of listeners.identify) listener(peer_id, agent)
    },
    announce: (address: string) => { for (const listener of listeners.library) listener(address) }
  }
}

describe('census helpers', () => {
  test('weeks start on Monday, UTC', () => {
    expect(week_start(SATURDAY_NOON)).toBe('2026-10-05')
    expect(week_start(Date.UTC(2026, 9, 11, 23, 59))).toBe('2026-10-05')
    expect(week_start(Date.UTC(2026, 9, 12))).toBe('2026-10-12')
  })

  test('only an exact agent string yields a version and mode', () => {
    expect(parse_agent('record-node/1.2 (masked)')).toEqual({ version: 'record-node/1.2', mode: 'masked' })
    expect(parse_agent('record-node/1.2 (masked) /ip4/1.2.3.4')).toEqual({ version: 'other', mode: undefined })
    expect(parse_agent('js-libp2p/3.3.11 node/22')).toEqual({ version: 'other', mode: undefined })
    expect(parse_agent(undefined)).toEqual({ version: 'other', mode: undefined })
  })
})

describe('census', () => {
  test('counts a day, closes it at midnight, and closes the week on Sunday', async () => {
    const { census, advance, set_connected, connect, announce, dir } = fake_census()
    await census.start()

    for (const peer of [PEER_A, PEER_B, PEER_C]) connect(peer, 'record-node/1.2 (public)')
    connect(PEER_D, 'record-node/1.1 (masked)')
    connect(PEER_A)
    announce(LIBRARY)
    announce(LIBRARY)
    for (const count of [2, 4, 3]) {
      set_connected(count)
      await census.tick()
    }
    expect(await census.read_row()).toMatchObject({ date: '2026-10-10', complete: false, distinct_peer_count: 4 })

    // Sunday: one returning peer and one new.
    advance(DAY_MS)
    connect(PEER_A, 'record-node/1.2 (public)')
    const saturday = await census.read_row('2026-10-10')
    expect(saturday).toEqual({
      date: '2026-10-10',
      complete: true,
      distinct_peer_count: 4,
      peak_connection_count: 4,
      // Samples 0 (at start), 2, 4, 3.
      median_connection_count: 3,
      masked_peer_count: 1,
      announced_library_count: 1,
      node_version_counts: { 'record-node/1.2': 3, other: 1 },
      rendezvous_address_count: 7
    })
    connect('12D3KooWNewPeerOnSundayxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'record-node/1.2 (public)')

    // Monday ends the week that ran Monday to Sunday.
    advance(DAY_MS)
    await census.tick()
    const sunday = await census.read_row('2026-10-11')
    expect(sunday).toMatchObject({ date: '2026-10-11', distinct_peer_count: 2, weekly_distinct_peer_count: 5 })
    expect(saturday?.weekly_distinct_peer_count).toBeUndefined()

    await census.stop()
    expect(readdirSync(dir).sort()).toEqual(['2026-10-10.jsonl', '2026-10-11.jsonl', '2026-10-12.jsonl'])
    // The stop row is partial; a complete row for the same day would win.
    expect(await census.read_row('2026-10-12')).toBeDefined()
  })

  test('a restart starts the week again: no key or peer outlives the process', async () => {
    const first = fake_census()
    await first.census.start()
    first.connect(PEER_A, 'record-node/1.2 (public)')
    await first.census.stop()
    const text = readFileSync(join(first.dir, '2026-10-10.jsonl'), 'utf8')
    expect(JSON.parse(text.trim())).toMatchObject({ complete: false, distinct_peer_count: 1 })
  })

  test('deletes rows older than 90 days', async () => {
    const { census, dir } = fake_census()
    writeFileSync(join(dir, '2026-07-11.jsonl'), '{}\n')
    writeFileSync(join(dir, '2026-07-12.jsonl'), '{}\n')
    writeFileSync(join(dir, 'notes.txt'), 'kept\n')
    await census.start()
    await census.stop()
    expect(readdirSync(dir).sort()).toEqual(['2026-07-12.jsonl', '2026-10-10.jsonl', 'notes.txt'])
  })

  test('writes no address, peer id, or library address', async () => {
    const { census, advance, connect, announce, dir } = fake_census()
    await census.start()
    for (const peer of [PEER_A, PEER_B, PEER_C, PEER_D]) connect(peer, 'record-node/1.2 (relayed)')
    connect('12D3KooWAgentProbe', 'record-node/1.2 (public) /ip4/10.0.0.1/tcp/4100')
    announce(LIBRARY)
    advance(DAY_MS)
    await census.tick()
    await census.stop()
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name), 'utf8')).not.toMatch(/\/ip4\/|\/ip6\/|12D3Koo|\/record\//)
    }
  })
})

describe('census on a running peer', () => {
  const peers = create_libp2p_peers()
  afterEach(async () => { await peers.stop_all() })

  test('counts a connecting peer by its mode, behind GET /network-census', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-census-peer-'))
    const counter = await peers.start({}, { census: true, data_dir })
    await peers.start({ bootstrap: [await dial_address(counter)] })
    await wait_until(async () => (await counter.get_network_census())?.node_version_counts.other === 1)
    expect(await counter.get_network_census()).toMatchObject({ complete: false, distinct_peer_count: 1, masked_peer_count: 0 })
  })
})
