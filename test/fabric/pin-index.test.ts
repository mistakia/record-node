// The pin index's eviction gate, with each interleaving forced: the block
// lookups and the removal wait on promises the test resolves, so neither
// order depends on how the scheduler happens to run them.

import { expect, test } from 'bun:test'
import { CID } from 'multiformats/cid'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

import { create_pin_index, open_pin_db } from '#fabric/pin-index.ts'

const deferred = () => {
  let release = () => {}
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, resolve: release }
}

// Lets every job already queued run before the test goes on.
const settle = async () => await new Promise((resolve) => setTimeout(resolve, 10))

// One stored raw block. `has` and the removal hold until the test releases
// them, and every call lands in `events` in the order it ran.
const harness = async () => {
  const leaf = CID.createV1(RAW_CODE, await sha256.digest(new TextEncoder().encode('leaf')))
  const events: string[] = []
  let stored = true
  let has_gate: Promise<void> = Promise.resolve()
  const index = create_pin_index({
    db: open_pin_db(),
    read: async () => undefined,
    has: async () => {
      events.push('has')
      await has_gate
      return stored
    }
  })
  return {
    leaf,
    events,
    index,
    hold_has: () => {
      const gate = deferred()
      has_gate = gate.promise
      return gate.resolve
    },
    remove: (gate: Promise<void>) => async () => {
      events.push('remove started')
      await gate
      stored = false
      events.push('removed')
    }
  }
}

test('an eviction that arrives during a pin walk waits for it, and keeps the block the pin covers', async () => {
  const { leaf, events, index, hold_has, remove } = await harness()
  const release_has = hold_has()
  const pin = index.pin(leaf, true)
  await settle()
  expect(events).toEqual(['has'])

  const evict = index.evict(leaf, remove(Promise.resolve()))
  await settle()
  // Neither the eviction's check nor its removal runs while the walk is open.
  expect(events).toEqual(['has'])

  release_has()
  await pin
  expect(await evict).toBe(false)
  expect(events).toEqual(['has'])
  expect(index.is_pinned(leaf)).toBe(true)
})

test('a pin that arrives during an eviction waits for it, then finds the block gone and pins nothing', async () => {
  const { leaf, events, index, remove } = await harness()
  const removal = deferred()
  const evict = index.evict(leaf, remove(removal.promise))
  await settle()
  expect(events).toEqual(['has', 'remove started'])

  const pin = index.pin(leaf, true)
  await settle()
  // The pin's walk has not looked at the block yet.
  expect(events).toEqual(['has', 'remove started'])

  removal.resolve()
  expect(await evict).toBe(true)
  await expect(pin).rejects.toMatchObject({ code: 'content_unavailable' })
  expect(events).toEqual(['has', 'remove started', 'removed', 'has'])
  expect(index.is_pinned(leaf)).toBe(false)
})
