// Opening a library: concurrent opens share one load.

import { expect, test } from 'bun:test'

import { generate_key_pair } from '#identity/key-pair.ts'
import { append_stored_track, open_library_manager } from '#test/helpers/library-manager.ts'

test('two concurrent opens of one library share a single load and handle', async () => {
  const { content_store, manager, reopen } = open_library_manager()
  const writer = generate_key_pair()
  const { chain } = await manager.create_library({ name: 'shared-open', type: 'recordstore', write_keys: [writer.public_key] })
  await append_stored_track({ manager, content_store, library_address: chain.address, key_pair: writer, fingerprint: 'AQAA-open-one', audio: 'audio one' })
  await manager.pins_settled()
  // A restart, where two callers reach the open before either has the handle.
  let reads = 0
  const restarted = reopen({ ...content_store, get: async (cid) => { reads++; return await content_store.get(cid) } })
  const [first, second] = await Promise.all([restarted.open_library(chain.address), restarted.open_library(chain.address)])
  expect(second).toBe(first)
  const single = reads
  // A third open after the first finished returns the held handle without reading.
  expect(await restarted.open_library(chain.address)).toBe(first)
  expect(reads).toBe(single)
  await restarted.pins_settled()
})
