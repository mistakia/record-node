// HTTP API boundary (spec/7-http-api.yaml). Each restates a protocol rule at the API surface; owned by the record-node-api-server task.
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('http-api', () => {
  test.todo('§7 POST /libraries/{address}/about [MUST] rejects an avatar that is not a CID (§2.6)', () => {})
  test.todo('§7 ResolverEntry [MUST] (extractor, id) uniquely identifies a source pointer (§2.4.2)', () => {})
  test.todo('§7 ResolverEntry [MUST] a streaming url is never persisted (§2.4.2)', () => {})
})
