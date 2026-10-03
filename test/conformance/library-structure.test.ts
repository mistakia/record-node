// Entry version, pinning, and query database (§4.1.1, §4.6, §4.7).
// §4.1.1 runs against src/entry and src/oplog. Pinning waits for the library
// lifecycle, and derivability for the query database.

import { describe, expect, test } from 'bun:test'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_track, open_test_library } from '#test/helpers/library.ts'

describe('library-structure', () => {
  test('§4.1.1 [MUST] signed entry v is 2', async () => {
    const writer = generate_key_pair()
    const { oplog } = await open_test_library({ writers: [writer] })
    const { entry, bytes } = append_track({ oplog, key_pair: writer })
    expect(entry.v).toBe(2)
    expect(decode_signed_entry(bytes).entry.v).toBe(2)
    expect(() => decode_signed_entry(encode_canonical({ ...entry, v: 1 }))).toThrow('entry v must be 2')
  })
  test.todo('§4.6 [MUST] AC chain objects are pinned for each opened library', () => {})
  test.todo('§4.6 [MUST] unlink unpins the AC chain objects', () => {})
  test.todo('§4.6 [MUST] unlink unpins entry objects only this library held', () => {})
  test.todo('§4.6 [MUST] unlink unpins content no other linked library references and keeps shared content', () => {})
  test.todo('§4.7 [MUST] the query database is fully derivable from the oplog', () => {})
  test.todo('§4.7 [MUST] rebuilding the query database equals incremental maintenance', () => {})
})
