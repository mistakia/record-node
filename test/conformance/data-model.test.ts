// Envelope, payload, listens, and operation shapes (§2.2, §2.4, §2.6, §2.7, §2.8.2).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('data-model', () => {
  test.todo('§2.2 [MUST] envelope timestamp is milliseconds since the Unix epoch and no other unit', () => {})
  test.todo('§2.2 [MUST] envelope v is 1', () => {})
  test.todo('§2.2 [MUST] envelope type is exactly "track", "log", or "about"', () => {})
  test.todo('§2.2 [MUST] envelope content is a base58btc CID per §2.1', () => {})
  test.todo('§2.2 [MUST] writers add no envelope extras beyond track tags', () => {})
  test.todo('§2.2 [MUST] receivers ignore unknown envelope extras and neither persist nor forward them', () => {})
  test.todo('§2.4.1 [MUST] track content carries hash, size, tags.acoustid_fingerprint, audio, artwork array, and resolver array', () => {})
  test.todo('§2.4.2 [MUST] resolver entries never persist a streaming url, and received entries carrying one are rejected', () => {})
  test.todo('§2.4.2 [MUST] (extractor, id) uniquely identifies an external source pointer', () => {})
  test.todo('§2.6 [MUST] about.address equals the owning library address', () => {})
  test.todo('§2.6 [MUST] about.avatar is a content-addressed CID, never a URL', () => {})
  test.todo('§2.7 [MUST] listens entries cannot be deleted', () => {})
  test.todo('§2.7 [MUST] a listen write without trackId is rejected', () => {})
  test.todo('§2.8.2 [MUST] DEL value.type is "track" or "log"', () => {})
  test.todo('§2.8.2 [MUST] about entries are never deleted', () => {})
  test.todo('§2.8.2 [MUST] DEL carries no content CID', () => {})
  test.todo('§2.8.2 [MUST] a received DEL of any other type is rejected at append verification and never reaches the oplog', () => {})
  test.todo('§2.8.2 [MUST] a listens-library DEL is rejected on local append', () => {})
  test.todo('§2.8.2 [MUST] a listens-library DEL is rejected on remote merge', () => {})
})
