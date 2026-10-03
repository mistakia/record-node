// Bounded fetch traversal (§5.4.2).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('traversal-bounds', () => {
  test.todo('§5.4.2 [MUST] traversal tracks the set of enqueued entry hashes', () => {})
  test.todo('§5.4.2 [MUST] an already-enqueued entry is never re-enqueued, so a cycle terminates', () => {})
  test.todo('§5.4.2 [MUST] next and refs each hold at most 256 elements', () => {})
  test.todo('§5.4.2 [MUST] an entry with more than 256 next or refs is rejected at signature verification', () => {})
  test.todo('§5.4.2 [MUST] a rejected fan-out entry enqueues none of its children', () => {})
  test.todo('§5.4.2 [MUST] in-flight fetches per library are bounded by a finite limit', () => {})
  test.todo('§5.4.2 [MUST] each fetch has a finite timeout', () => {})
  test.todo('§5.4.2 [MUST] a timed-out entry is recorded as unresolved', () => {})
  test.todo('§5.4.2 [MUST] a timed-out entry does not block the traversal', () => {})
  test.todo('§5.4.2 [MUST] entries with unfetched ancestors are not merged', () => {})
  test.todo('§5.4.2 [MUST] resume re-enters at the earliest unresolved entry without re-fetching landed entries', () => {})
})
