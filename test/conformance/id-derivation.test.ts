// ID derivation (§2.2, §2.3, §6.1.4).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('id-derivation', () => {
  test.todo('§2.3.1 [vector] sha256 helper maps "hello" to 2cf24dba…', () => {})
  test.todo('§2.2 [MUST] envelope id is computed per §2.3 for its type', () => {})
  test.todo('§2.2 [MUST] envelope id is lowercase hex', () => {})
  test.todo('§2.2 [MUST] envelope id is the plain sha256 hex digest with no prefix, separator, or salt', () => {})
  test.todo('§2.3 [MUST] log and about ids hash the exact library address including /record/ and /<name>', () => {})
  test.todo('§2.3 [MUST] log and about entries are told apart by envelope type, not by id', () => {})
  test.todo('§6.1.4 [MUST] track id hashes the fingerprint string, not its decoded bytes', () => {})
  test.todo('§6.1.4 [MUST] track id is lowercase hex', () => {})
})
