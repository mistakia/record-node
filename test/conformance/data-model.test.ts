// Envelope, payload, listens, and operation shapes (§2.2, §2.4, §2.6, §2.7,
// §2.8.2), against src/entry and src/oplog.

import { describe, expect, test } from 'bun:test'
import { base32 } from 'multiformats/bases/base32'

import { parse_cid } from '#encoding/cid.ts'
import { build_about_envelope, build_log_envelope, build_track_envelope, validate_envelope } from '#entry/envelope.ts'
import { build_del_operation, validate_operation } from '#entry/operations.ts'
import { resolver_key, validate_about_content, validate_track_content } from '#entry/payload.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_entry } from '#oplog/dag.ts'
import { append_listen } from '#oplog/listens.ts'
import { merge_entries } from '#oplog/merge.ts'
import { open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { envelope_vectors } from './vectors.ts'

const [track_vector, , about_vector] = envelope_vectors
const ID = track_vector.id
const CONTENT = track_vector.content
const ENVELOPE_FIELDS = ['id', 'timestamp', 'v', 'type', 'content']
const writer = generate_key_pair()

const envelope_with = (overrides: Record<string, unknown>) =>
  ({ id: ID, timestamp: 1611272666695, v: 1, type: 'track', content: CONTENT, ...overrides })

const without = (value: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))

const forged_block = (address: string, payload: unknown) =>
  sign_raw({ private_key: writer.private_key, fields: { id: address, payload, clock: { id: writer.public_key, time: 1 } } }).bytes

describe('data-model', () => {
  test('§2.2 [MUST] envelope timestamp is milliseconds since the Unix epoch and no other unit', () => {
    const before = Date.now()
    const { timestamp } = build_track_envelope({ id: ID, content_cid: CONTENT })
    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(Date.now())
    for (const bad of [1.5, -1, '1611272666695']) {
      expect(() => validate_envelope(envelope_with({ timestamp: bad }))).toThrow('unsigned integer milliseconds')
    }
  })

  test('§2.2 [MUST] envelope v is 1', () => {
    expect(build_log_envelope({ id: ID, content_cid: CONTENT }).v).toBe(1)
    expect(() => validate_envelope(envelope_with({ v: 2 }))).toThrow('envelope v must be 1')
  })

  test('§2.2 [MUST] envelope type is exactly "track", "log", or "about"', () => {
    for (const type of ['Track', 'listen', 'TRACK', '']) {
      expect(() => validate_envelope(envelope_with({ type }))).toThrow('envelope type must be one of')
    }
  })

  test('§2.2 [MUST] envelope content is a base58btc CID per §2.1', () => {
    // The same CID in base32, a sha2-256 legacy CID, and a URL.
    for (const content of [parse_cid(CONTENT).toString(base32), 'zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc', 'https://example.com/x']) {
      expect(() => validate_envelope(envelope_with({ content }))).toThrow('envelope content must be')
    }
  })

  test('§2.2 [MUST] writers add no envelope extras beyond track tags', () => {
    expect(Object.keys(build_track_envelope({ id: ID, content_cid: CONTENT, tags: ['a'] })).sort()).toEqual([...ENVELOPE_FIELDS, 'tags'].sort())
    expect(Object.keys(build_track_envelope({ id: ID, content_cid: CONTENT })).sort()).toEqual([...ENVELOPE_FIELDS].sort())
    expect(Object.keys(build_about_envelope({ id: ID, content_cid: CONTENT })).sort()).toEqual([...ENVELOPE_FIELDS].sort())
  })

  test('§2.2 [MUST] receivers ignore unknown envelope extras and neither persist nor forward them', async () => {
    expect(Object.keys(validate_envelope(envelope_with({ color: 'red', tags: ['x'] }))).sort()).toEqual([...ENVELOPE_FIELDS, 'tags'].sort())
    expect(Object.keys(validate_envelope(envelope_with({ type: 'log', tags: ['x'] })))).not.toContain('tags')
    const { oplog } = await open_test_library({ writers: [writer] })
    const payload = { op: 'PUT', key: ID, value: envelope_with({ color: 'red' }) }
    const { merged } = merge_entries({ oplog, blocks: [forged_block(oplog.chain.address, payload)] })
    expect(merged.length).toBe(1)
    expect(oplog.current.get(ID)?.operation).toEqual({ op: 'PUT', key: ID, value: envelope_with({}) } as never)
  })

  test('§2.4.1 [MUST] track content carries hash, size, tags.acoustid_fingerprint, audio, artwork array, and resolver array', () => {
    const content = track_vector.payload
    expect(validate_track_content(content)).toBe(content)
    for (const field of ['hash', 'size', 'tags', 'audio', 'artwork', 'resolver']) {
      expect(() => validate_track_content(without(content, field))).toThrow()
    }
    expect(() => validate_track_content({ ...content, tags: without(content.tags, 'acoustid_fingerprint') })).toThrow('acoustid_fingerprint')
    expect(() => validate_track_content({ ...content, artwork: null })).toThrow('artwork must be an array')
    // hash and artwork are base58btc CID strings, never dag-cbor links (v1.0.4).
    const link = parse_cid(CONTENT)
    expect(() => validate_track_content({ ...content, hash: link })).toThrow('hash must be a CID')
    expect(() => validate_track_content({ ...content, artwork: [link] })).toThrow('artwork must be an array of CIDs')
    expect(() => validate_track_content({ ...content, hash: link.toString(base32) })).toThrow('hash must be a CID')
  })

  test('§2.4.2 [MUST] resolver entries never persist a streaming url, and received entries carrying one are rejected', () => {
    const resolver = [{ extractor: 'youtube', id: 'abc', url: 'https://cdn.example/stream?sig=1' }]
    expect(() => validate_track_content({ ...track_vector.payload, resolver })).toThrow('must not carry a streaming url')
  })

  test('§2.4.2 [MUST] (extractor, id) uniquely identifies an external source pointer', () => {
    expect(resolver_key({ extractor: 'youtube', id: 'abc' })).not.toBe(resolver_key({ extractor: 'bandcamp', id: 'abc' }))
    expect(resolver_key({ extractor: 'a|b', id: 'c' })).not.toBe(resolver_key({ extractor: 'a', id: 'b|c' }))
    const resolver = [{ extractor: 'youtube', id: 'abc', fulltitle: 'one' }, { extractor: 'youtube', id: 'abc', fulltitle: 'two' }]
    expect(() => validate_track_content({ ...track_vector.payload, resolver })).toThrow('repeat the source pointer')
  })

  test('§2.6 [MUST] about.address equals the owning library address', () => {
    const library_address = about_vector.id_input
    expect(validate_about_content({ value: about_vector.payload, library_address })).toBe(about_vector.payload)
    expect(() => validate_about_content({ value: about_vector.payload, library_address: `${library_address}2` }))
      .toThrow('must equal the owning library address')
  })

  test('§2.6 [MUST] about.avatar is a content-addressed CID, never a URL', () => {
    const library_address = about_vector.id_input
    const value = (avatar: unknown) => ({ ...about_vector.payload, avatar })
    expect(() => validate_about_content({ value: value(CONTENT), library_address })).not.toThrow()
    expect(() => validate_about_content({ value: value('https://example.com/me.png'), library_address })).toThrow('not a URL')
  })

  test('§2.7 [MUST] listens entries cannot be deleted', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    const listen = append_listen({ oplog, track_id: ID, address: oplog.chain.address, key_pair: writer })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: listen.hash, type: 'track' }) }))
      .toThrow('accepts only listen writes')
    expect(oplog.entries.size).toBe(1)
  })

  test('§2.7 [MUST] a listen write without trackId is rejected', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_listen({ oplog, track_id: '', address: oplog.chain.address, key_pair: writer })).toThrow('requires trackId')
    expect(() => append_entry({ oplog, key_pair: writer, payload: { address: oplog.chain.address, timestamp: 1 } })).toThrow('requires trackId')
    expect(oplog.entries.size).toBe(0)
  })

  test('§2.8.2 [MUST] DEL value.type is "track" or "log"', () => {
    expect(build_del_operation({ key: ID, type: 'track' }).value.type).toBe('track')
    expect(build_del_operation({ key: ID, type: 'log' }).value.type).toBe('log')
    for (const type of ['about', 'listen', 'Track']) {
      expect(() => build_del_operation({ key: ID, type: type as never })).toThrow('DEL value.type must be track or log')
    }
  })

  test('§2.8.2 [MUST] about entries are never deleted', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const payload = { op: 'DEL', key: ID, value: { type: 'about', timestamp: 1 } }
    expect(() => append_entry({ oplog, key_pair: writer, payload })).toThrow('about entries are never deleted')
  })

  test('§2.8.2 [MUST] DEL carries no content CID', () => {
    const payload = { op: 'DEL', key: ID, value: { type: 'track', timestamp: 1, content: CONTENT } }
    expect(() => validate_operation({ payload, library_type: 'recordstore' })).toThrow('no content CID')
  })

  test('§2.8.2 [MUST] a received DEL of any other type is rejected at append verification and never reaches the oplog', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const blocks = ['about', 'listen', 'artist'].map((type) =>
      forged_block(oplog.chain.address, { op: 'DEL', key: ID, value: { type, timestamp: 1 } }))
    const { merged, rejected } = merge_entries({ oplog, blocks })
    expect(merged).toEqual([])
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_operation', 'invalid_operation', 'invalid_operation'])
    expect(oplog.entries.size).toBe(0)
  })

  test('§2.8.2 [MUST] a listens-library DEL is rejected on local append', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: ID, type: 'track' }) }))
      .toThrow('accepts only listen writes')
  })

  test('§2.8.2 [MUST] a listens-library DEL is rejected on remote merge', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    const listen = forged_block(oplog.chain.address, { trackId: ID, address: oplog.chain.address, timestamp: 1 })
    const del = forged_block(oplog.chain.address, build_del_operation({ key: ID, type: 'track' }))
    const put = forged_block(oplog.chain.address, track_put())
    const { merged, rejected } = merge_entries({ oplog, blocks: [listen, del, put] })
    expect(merged.length).toBe(1)
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_operation', 'invalid_operation'])
  })
})
