// Deduplication guarantees (§2.10). The §2.10 content.hash stability wording is pending an operator ruling; these stubs track the current section text.
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('dedup', () => {
  test.todo('§2.10 [MUST] tracks with the same sha256(fingerprint) are the same track', () => {})
  test.todo('§2.10 [MUST] the fingerprint is the same regardless of tags, artwork, or container framing', () => {})
  test.todo('§2.10 [MUST] tag-stripped blobs are byte-identical for the same source audio, so content.hash is stable across peers (wording pending operator ruling)', () => {})
  test.todo('§2.10 [MUST] duplicate_key treats a missing tags field as []', () => {})
  test.todo('§2.10 [MUST] duplicate_key sorts tags lexicographically before comparison', () => {})
  test.todo('§2.10 [MUST] a rejected duplicate PUT is not appended to the oplog', () => {})
  test.todo('§2.10 [check] a PUT whose duplicate_key equals a live entry is rejected with an identifiable error', () => {})
})
