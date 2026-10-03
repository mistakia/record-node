// Entry signing and entry hash (§3.4, §4.1).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('signing-vector', () => {
  test.todo('§3.4.1 [MUST] the unsigned entry has no hash field', () => {})
  test.todo('§3.4.2 [MUST] the signing input is the dag-cbor encoding of the unsigned entry', () => {})
  test.todo('§3.4.2 [MUST] identical entry objects encode to byte-identical dag-cbor', () => {})
  test.todo('§3.4.4 [MUST] signatures are ECDSA over secp256k1 on the SHA-256 digest, DER-encoded', () => {})
  test.todo('§3.4.5 [MUST] the test-only private key k=1 is refused as a real identity', () => {})
  test.todo('§3.4.5 [MUST] the F0 unsigned entry encodes to exactly the 468 spec bytes', () => {})
  test.todo('§3.4.5 [vector] the F0 SHA-256 digest is fd55233a…', () => {})
  test.todo('§3.4.5 [vector] the F0 RFC 6979 signature is 3045022100ab7ece3c…', () => {})
  test.todo('§3.4.5 [vector] verify_entry_signature accepts the F0 signed entry', () => {})
  test.todo('§4.1.1 [MUST] the F0 signed entry hash is zBwWX7sbGgnam… (§4.1.1, §4.1.2)', () => {})
  test.todo('§4.1.2 [vector] the child entry with non-empty next hashes to zBwWX6N1WUQh…, with next stored as strings', () => {})
})
