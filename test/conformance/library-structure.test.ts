// Entry version, pinning, and query database (§4.1.1, §4.6, §4.7).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('library-structure', () => {
  test.todo('§4.1.1 [MUST] signed entry v is 2', () => {})
  test.todo('§4.6 [MUST] AC chain objects are pinned for each opened library', () => {})
  test.todo('§4.6 [MUST] unlink unpins the AC chain objects', () => {})
  test.todo('§4.6 [MUST] unlink unpins entry objects only this library held', () => {})
  test.todo('§4.6 [MUST] unlink unpins content no other linked library references and keeps shared content', () => {})
  test.todo('§4.7 [MUST] the query database is fully derivable from the oplog', () => {})
  test.todo('§4.7 [MUST] rebuilding the query database equals incremental maintenance', () => {})
})
