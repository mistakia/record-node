// Content addressing (§2.1, §2.2.1, §2.3.1).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('content-cid', () => {
  test.todo('§2.1 [MUST] envelope payloads are stored as dag-cbor objects hashed with sha3-512', () => {})
  test.todo('§2.1 [MUST] content CID is dag-cbor, then sha3-512, then CIDv1 with dag-cbor codec, then base58btc', () => {})
  test.todo('§2.1 [MUST] readers reject non-canonical dag-cbor input instead of re-encoding it', () => {})
  test.todo('§2.3.1 [MUST] {"hello":"world"} encodes to a16568656c6c6f65776f726c64 and yields CID zBwWX8pQhjGa…', () => {})
  test.todo('§2.2.1 [vector] F2 track, log, and about payloads yield the spec content CIDs', () => {})
})
