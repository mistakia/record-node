// Size bounds at deserialization (§2.8.3).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('size-bounds', () => {
  test.todo('§2.8.3 [MUST] a signed entry over 256 KiB of dag-cbor is rejected', () => {})
  test.todo('§2.8.3 [MUST] an envelope payload over 1 MiB of dag-cbor is rejected', () => {})
  test.todo('§2.8.3 [MUST] a track envelope with more than 256 tags is rejected', () => {})
  test.todo('§2.8.3 [MUST] a tag over 128 UTF-8 bytes is rejected', () => {})
  test.todo('§2.8.3 [MUST] a tags array serialising over 8 KiB is rejected', () => {})
  test.todo('§2.8.3 [MUST] oversized entries and payloads are dropped at verification time, before signature checks', () => {})
})
