// The peer-wait budget counts only the time spent waiting on peers, so the
// gaps between fetches, a slow client's reads, never spend it.

import { expect, spyOn, test } from 'bun:test'

import { create_peer_wait_budget } from '#peer/peer-wait-budget.ts'

const FETCH_MS = 60
const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))

// Every block arrives FETCH_MS after it is asked for, unless the signal aborts first.
const slow_network = {
  fetch_block: async (_cid: string, { signal }: { signal: AbortSignal }) => await new Promise<Uint8Array | undefined>((resolve) => {
    const timer = setTimeout(() => { resolve(new Uint8Array([1])) }, FETCH_MS)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
  })
}

test('time between fetches does not spend the budget; time waiting does', async () => {
  const fetch_within_budget = create_peer_wait_budget({ network: slow_network, timeout_ms: 150 })
  expect(await fetch_within_budget('a')).toBeDefined()
  await sleep(300)
  expect(await fetch_within_budget('b')).toBeDefined()
  // About 30 ms remain, less than one fetch takes.
  expect(await fetch_within_budget('c')).toBeUndefined()
  expect(await fetch_within_budget('d')).toBeUndefined()
})

test('each wait gets whole milliseconds, which is all Node\'s AbortSignal.timeout takes', async () => {
  const timeout = spyOn(AbortSignal, 'timeout')
  try {
    const fetch_within_budget = create_peer_wait_budget({ network: slow_network, timeout_ms: 1000 })
    await fetch_within_budget('a')
    await fetch_within_budget('b')
    expect(timeout.mock.calls.length).toBe(2)
    for (const [ms] of timeout.mock.calls) expect(Number.isInteger(ms)).toBe(true)
  } finally {
    timeout.mockRestore()
  }
})

test('a closed request ends its wait at once and asks no more', async () => {
  const closed = new AbortController()
  const fetch_within_budget = create_peer_wait_budget({ network: slow_network, timeout_ms: 10_000, closed: closed.signal })
  const started_at = performance.now()
  const waiting = fetch_within_budget('a')
  setTimeout(() => { closed.abort() }, 10)
  expect(await waiting).toBeUndefined()
  expect(performance.now() - started_at).toBeLessThan(FETCH_MS)
  expect(await fetch_within_budget('b')).toBeUndefined()
})
