// Keys, addresses, and library names (§3.1, §3.3, §3.6, §3.7).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('identity-and-access', () => {
  test.todo('§3.1 [MUST] an entry.key or write-list element that is not 66 lowercase hex starting 02 or 03 is rejected', () => {})
  test.todo('§3.1 [MUST] uncompressed (04) and hybrid (06, 07) keys are rejected even when mathematically equivalent', () => {})
  test.todo('§3.3 [MUST] a library whose writer stopped appending stays valid', () => {})
  test.todo('§3.6 [MUST] a library address has the exact form /record/<manifest-cid>/<name>', () => {})
  test.todo('§3.6 [MUST] addresses are transported and compared as opaque strings', () => {})
  test.todo('§3.7 [MUST] library names match ^[0-9a-zA-Z-]*$', () => {})
  test.todo('§3.7 [MUST] library creation enforces the name character set', () => {})
})
