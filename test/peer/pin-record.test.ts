// The library pin record: an open whose recorded pin set is clean takes it
// back instead of reading every entry's payload, and anything that leaves the
// record in doubt makes the next open re-pin every entry.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ContentStore } from '#fabric/content-store.ts'
import { create_library_pin_record, open_pin_db } from '#fabric/pin-index.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_stored_track, open_library_manager } from '#test/helpers/library-manager.ts'

// A library of three stored tracks, its pin set settled.
const written = async () => {
  const opened = open_library_manager()
  const { content_store, manager } = opened
  const writer = generate_key_pair()
  const { chain } = await manager.create_library({ name: 'pinned', type: 'recordstore', write_keys: [writer.public_key] })
  const tracks = []
  for (const fingerprint of ['AQAA-record-one', 'AQAA-record-two', 'AQAA-record-three']) {
    tracks.push(await append_stored_track({ manager, content_store, library_address: chain.address, key_pair: writer, fingerprint, audio: `audio of ${fingerprint}` }))
  }
  await manager.pins_settled()
  return { ...opened, library_address: chain.address, tracks, pins: new Map(manager.get(chain.address)?.pins) }
}

// The content store, with every read of a track's content payload counted.
const counting = (content_store: ContentStore, content_cids: readonly string[]) => {
  const reads: string[] = []
  const store: ContentStore = {
    ...content_store,
    get: async (cid) => {
      if (content_cids.includes(cid)) reads.push(cid)
      return await content_store.get(cid)
    }
  }
  return { store, reads }
}

const restart = async (setup: Awaited<ReturnType<typeof written>>) => {
  const { store, reads } = counting(setup.content_store, setup.tracks.map(({ content_cid }) => content_cid))
  const manager = setup.reopen(store)
  await manager.open_library(setup.library_address)
  await manager.pins_settled()
  return { manager, reads, pins: manager.get(setup.library_address)?.pins }
}

describe('library pin record', () => {
  test('a restart whose record is clean reads no content payload and holds the same pin set', async () => {
    const setup = await written()
    const { reads, pins } = await restart(setup)
    expect(reads).toEqual([])
    expect(pins).toEqual(setup.pins)
  })

  test('a change in flight at a crash leaves the record dirty, so the next open re-pins every entry', async () => {
    const setup = await written()
    setup.pin_record.begin(setup.library_address)
    const { reads, pins } = await restart(setup)
    expect(reads.sort()).toEqual(setup.tracks.map(({ content_cid }) => content_cid).sort())
    expect(pins).toEqual(setup.pins)
    // That pass left the record clean again.
    expect((await restart(setup)).reads).toEqual([])
  })

  test('an entry the record does not cover is re-pinned at open, alone', async () => {
    const setup = await written()
    const [first] = setup.tracks
    if (first === undefined) throw new Error('no track written')
    setup.pin_record.delete(setup.library_address, [first.entry_hash])
    const { reads, pins } = await restart(setup)
    expect(reads).toEqual([first.content_cid])
    expect(pins).toEqual(setup.pins)
  })

  test('a release is recorded, so the restart does not count the released blob as held', async () => {
    const setup = await written()
    const [first] = setup.tracks
    if (first === undefined) throw new Error('no track written')
    await setup.manager.release_blobs({ library_address: setup.library_address, cids: [first.audio_cid] })
    const { reads, pins } = await restart(setup)
    expect(reads).toEqual([])
    expect(pins?.has(first.audio_cid)).toBe(false)
    expect(await setup.content_store.is_pinned(first.audio_cid)).toBe(false)
  })

  test('an unlink drops the record', async () => {
    const setup = await written()
    await setup.manager.unlink_library(setup.library_address)
    expect(setup.pin_record.load(setup.library_address)).toBeUndefined()
  })

  test('a pin index of another version drops the record with the counts', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'record-pin-record-test-')), 'pins.sqlite')
    const db = open_pin_db(path)
    const record = create_library_pin_record({ db })
    record.set('library', [['cid', true]])
    record.settle('library')
    expect(record.load('library')).toEqual(new Map([['cid', true]]))
    db.exec("UPDATE meta SET value = 'older' WHERE key = 'schema_version'")
    db.close()
    expect(create_library_pin_record({ db: open_pin_db(path) }).load('library')).toBeUndefined()
  })
})
