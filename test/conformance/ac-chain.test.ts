// Access-control chain and append verification (§3.5).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('ac-chain', () => {
  test.todo('§3.5.1 [vector] F3 write-list, wrapper, and manifest CIDs and the assembled address match the spec', () => {})
  test.todo('§3.5.1 [check] creating a chain and resolving its address returns the same write-list', () => {})
  test.todo('§3.5.1 [MUST] all three chain objects are pinned when a library loads', () => {})
  test.todo('§3.5.1 [MUST] chain objects are not unpinned while the library is in use', () => {})
  test.todo('§3.5.1 [MUST] a manifest that fails to decode or has the wrong field set rejects the library', () => {})
  test.todo('§3.5.1 [MUST] a manifest name that differs from the address name rejects the library', () => {})
  test.todo('§3.5.1 [MUST] an AC wrapper that does not match the wrapper shape rejects the library', () => {})
  test.todo('§3.5.1 [MUST] an AC wrapper type the implementation does not recognise rejects the library', () => {})
  test.todo('§3.5.1 [MUST] a write-list that does not match the write-list shape rejects the library', () => {})
  test.todo('§3.5.1 [MUST] any invalid write-list element rejects the library', () => {})
  test.todo('§3.5.1 [MUST] a chain object that cannot be fetched leaves the library unopenable', () => {})
  test.todo('§3.5.1 [MUST] nothing proceeds on a library without a verified chain', () => {})
  test.todo('§3.5.2 [MUST] a non-static AC type refuses open, replicate, and append', () => {})
  test.todo('§3.5.3 [MUST] write-lists of any length load', () => {})
  test.todo('§3.5.3 [MUST] replicating peers verify the signer appears in the write-list', () => {})
  test.todo('§3.5.4 [MUST] a remote entry signature is verified with entry.key before append', () => {})
  test.todo('§3.5.4 [MUST] entry.key membership in the write-list is checked by plain string equality', () => {})
  test.todo('§3.5.4 [MUST] an entry failing either check is rejected, including one signed by a key outside the write-list', () => {})
})
