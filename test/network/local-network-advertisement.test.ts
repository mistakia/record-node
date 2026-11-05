// The local-network advertisement (src/network/local-network-advertisement.ts)
// on loopback at a private mDNS port, queried by a second responder.

import { afterEach, describe, expect, test } from 'bun:test'
import { createSocket } from 'node:dgram'

import make_mdns from 'multicast-dns'
import type { Answer, TxtAnswer } from 'dns-packet'

import { SERVICE_TYPE, start_local_network_advertisement } from '../../src/network/local-network-advertisement.ts'

const free_udp_port = async (): Promise<number> => await new Promise((resolve) => {
  const socket = createSocket('udp4')
  socket.bind(0, '127.0.0.1', () => {
    const { port } = socket.address()
    socket.close(() => { resolve(port) })
  })
})

const data_of = (answer: Answer | undefined): unknown => (answer as { data?: unknown } | undefined)?.data

const txt_values = (answer: Answer): Record<string, string> => Object.fromEntries(((answer as TxtAnswer).data as Buffer[])
  .map((entry) => entry.toString().split(/=(.*)/s).slice(0, 2)))

describe('local network advertisement', () => {
  const cleanups: Array<() => Promise<void> | void> = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  test('answers a browse with node_url and peer_id, and says goodbye on stop', async () => {
    const port = await free_udp_port()
    const browser = make_mdns({ interface: '127.0.0.1', bind: '0.0.0.0', port })
    cleanups.push(async () => { await new Promise<void>((resolve) => { browser.destroy(() => { resolve() }) }) })
    await new Promise<void>((resolve) => { browser.once('ready', resolve) })
    const answers: Answer[] = []
    browser.on('response', (response) => { answers.push(...(response.answers ?? []), ...(response.additionals ?? [])) })

    const stop = await start_local_network_advertisement({ node_url: 'http://127.0.0.1:18090', peer_id: '12D3KooWTest', host_name: 'testhost', port })
    browser.query({ questions: [{ name: SERVICE_TYPE, type: 'PTR' }] })
    const deadline = Date.now() + 3000
    const txt = () => answers.find((answer) => answer.type === 'TXT' && answer.ttl !== 0)
    while (txt() === undefined && Date.now() < deadline) await Bun.sleep(25)

    expect(data_of(answers.find((answer) => answer.type === 'PTR' && answer.name === SERVICE_TYPE))).toBe(`testhost.${SERVICE_TYPE}`)
    expect(txt_values(txt() as Answer)).toEqual({ node_url: 'http://127.0.0.1:18090', peer_id: '12D3KooWTest' })
    expect(data_of(answers.find((answer) => answer.type === 'SRV'))).toMatchObject({ port: 18090, target: 'record-node-testhost.local' })
    expect(data_of(answers.find((answer) => answer.type === 'A'))).toBe('127.0.0.1')

    await stop()
    const goodbye_deadline = Date.now() + 3000
    const goodbye = () => answers.find((answer) => answer.type === 'PTR' && answer.name === SERVICE_TYPE && answer.ttl === 0)
    while (goodbye() === undefined && Date.now() < goodbye_deadline) await Bun.sleep(25)
    expect(goodbye()).toBeDefined()
  })

  test('rejects when the interface address is not on this host', async () => {
    const port = await free_udp_port()
    await expect(start_local_network_advertisement({ node_url: 'http://192.0.2.1:18090', peer_id: '12D3KooWTest', port })).rejects.toThrow('no interface on this host has the address 192.0.2.1')
  })
})
