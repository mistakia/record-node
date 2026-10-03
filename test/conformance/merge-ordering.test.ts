// Current-state resolution and merge (§4.4.2, §4.5).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('merge-ordering', () => {
  test.todo('§4.4.2 [vector] F5 race set resolves to entry C', () => {})
  test.todo('§4.4.2 [MUST] clock.time orders first, then envelope timestamp, then entry hash', () => {})
  test.todo('§4.4.2 [MUST] peers holding the same signed entries agree on the order', () => {})
  test.todo('§4.4.2 [MUST] the hash tiebreak compares raw multihash bytes, not base58btc strings', () => {})
  test.todo('§4.4.2 [check] a DEL that sorts first tombstones the PUT with the same key', () => {})
  test.todo('§4.4.2 [MUST] PUT and DEL effects apply only to the current entry', () => {})
  test.todo('§4.4.2 [MUST] recomputing on merge uses every known entry for the key', () => {})
  test.todo('§4.5 [MUST] an entry failing verification is dropped and absent from the merged state', () => {})
  test.todo('§4.5 [MUST] inserting an entry whose hash already exists is a no-op', () => {})
  test.todo('§4.5 [MUST] merge is associative and commutative: merge(merge(A,B),C) equals merge(A,merge(B,C)) and merge(C,merge(B,A))', () => {})
  test.todo('§4.5 [MUST] concurrent merge batches end in the same query-index state as one merge over their union', () => {})
})
