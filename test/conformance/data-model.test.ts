// Envelope, payload, label and About records, listens, and operation shapes
// (§2.2, §2.4, §2.5, §2.6, §2.7, §2.8), against src/entry and src/oplog.

import { describe, expect, test } from 'bun:test'
import { base32 } from 'multiformats/bases/base32'

import { parse_cid } from '#encoding/cid.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { record_key } from '#access-control/capability-record.ts'
import { build_track_envelope, validate_envelope } from '#entry/envelope.ts'
import { build_about_put, build_del_operation, build_labels_put, validate_operation } from '#entry/operations.ts'
import { resolver_key, validate_track_content } from '#entry/payload.ts'
import { ABOUT_KEY, build_about_record, build_labels_record, validate_about_record, validate_labels_record } from '#entry/records.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_entry } from '#oplog/dag.ts'
import { append_listen } from '#oplog/listens.ts'
import { merge_entries } from '#oplog/merge.ts'
import { open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { about_record_vector, track_envelope_vector as track_vector } from './vectors.ts'

const ID: string = track_vector.id
const CONTENT = track_vector.content
const ENVELOPE_FIELDS = ['id', 'timestamp', 'v', 'type', 'content']
const writer = generate_key_pair()

const envelope_with = (overrides: Record<string, unknown>) =>
  ({ id: ID, timestamp: 1611272666695, v: 1, type: 'track', content: CONTENT, ...overrides })

const without = (value: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))

const sha256_of_address = () => sha256_hex('/record/x/library')

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
    expect(build_track_envelope({ id: ID, content_cid: CONTENT }).v).toBe(1)
    expect(() => validate_envelope(envelope_with({ v: 2 }))).toThrow('envelope v must be 1')
  })

  test('§2.2 [MUST] envelope type is exactly "track"', () => {
    for (const type of ['Track', 'listen', 'TRACK', '', 'log', 'about']) {
      expect(() => validate_envelope(envelope_with({ type }))).toThrow('envelope type must be track')
    }
  })

  test('§2.2 [MUST] envelope content is a base58btc CID per §2.1', () => {
    // The same CID in base32, a sha2-256 legacy CID, and a URL.
    for (const content of [parse_cid(CONTENT).toString(base32), 'zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc', 'https://example.com/x']) {
      expect(() => validate_envelope(envelope_with({ content }))).toThrow('envelope content must be')
    }
  })

  test('§2.2 [MUST] writers add no envelope extras', () => {
    expect(Object.keys(build_track_envelope({ id: ID, content_cid: CONTENT })).sort()).toEqual([...ENVELOPE_FIELDS].sort())
  })

  test('§2.2 [MUST] receivers ignore unknown envelope extras and neither persist nor forward them', async () => {
    // A v1 envelope's tags are an unknown extra like any other.
    expect(Object.keys(validate_envelope(envelope_with({ color: 'red', tags: ['x'] }))).sort()).toEqual([...ENVELOPE_FIELDS].sort())
    const { oplog } = await open_test_library({ writers: [writer] })
    const payload = { op: 'PUT', key: ID, value: envelope_with({ color: 'red', tags: ['x'] }) }
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

  test('§2.5 [MUST] a label record is a PUT keyed by the sha256 of its dag-cbor value', () => {
    const put = build_labels_put({ set: [[ID, 'a']], unset: [[ID, 'b']], timestamp: 1 })
    expect(put.value).toEqual({ type: 'labels', v: 1, timestamp: 1, set: [[ID, 'a']], unset: [[ID, 'b']] })
    expect(put.key).toBe(record_key(put.value))
    expect(() => validate_labels_record({ key: ABOUT_KEY, value: put.value })).toThrow('key is the sha256 of its value')
    expect(validate_operation({ payload: put, library_type: 'recordstore' })).toEqual(put)
  })

  test('§2.5 [MUST] a label pair names a 64-lowercase-hex track id and a label in NFC of 1 to 128 UTF-8 bytes with no control character', () => {
    const labels = (label: string, track_id = ID) => () => build_labels_record({ set: [[track_id, label]] })
    expect(labels('x'.repeat(128))).not.toThrow()
    expect(labels('mix/\u00e9')).not.toThrow()
    expect(labels('')).toThrow('non-empty')
    expect(labels('cafe\u0301')).toThrow('Normalization Form C')
    for (const control of ['\u0000', '\u0007', '\n', '\u007f', '\u0085']) expect(labels(`a${control}`)).toThrow('control character')
    // 65 characters, 130 UTF-8 bytes: the bound counts bytes, not characters.
    expect(labels('é'.repeat(65))).toThrow('label is 130 bytes')
    expect(labels('a', ID.toUpperCase())).toThrow('64 lowercase hex')
    expect(labels('a', ID.slice(1))).toThrow('64 lowercase hex')
  })

  test('§2.5 [MUST] a label record names at least one pair, each at most once across set and unset', () => {
    expect(() => build_labels_record({})).toThrow('at least one pair')
    expect(() => build_labels_record({ set: [[ID, 'a'], [ID, 'a']] })).toThrow('more than once')
    expect(() => build_labels_record({ set: [[ID, 'a']], unset: [[ID, 'a']] })).toThrow('more than once')
    expect(() => build_labels_record({ set: [[ID, 'a']], unset: [[ID, 'b']] })).not.toThrow()
  })

  test('§2.5 [MUST] a receiver rejects a label record carrying a field §2.5 does not define', () => {
    const value = { type: 'labels', v: 1, timestamp: 1, set: [[ID, 'a']], unset: [], note: 'x' }
    expect(() => validate_labels_record({ key: record_key(value), value })).toThrow('note')
    expect(() => validate_operation({ payload: { op: 'PUT', key: record_key(value), value }, library_type: 'recordstore' })).toThrow('note')
  })

  test('§2.6 [MUST] an About record is a PUT keyed by sha256("about") carrying a name of 1 to 128 UTF-8 bytes', () => {
    expect(ABOUT_KEY).toBe(about_record_vector.operation_key)
    const put = build_about_put({ name: about_record_vector.record.name, timestamp: about_record_vector.record.timestamp })
    expect(put).toEqual({ op: 'PUT', key: ABOUT_KEY, value: about_record_vector.record })
    expect(() => build_about_record({ name: '' })).toThrow('1 to 128 UTF-8 bytes')
    expect(() => build_about_record({ name: 'é'.repeat(65) })).toThrow('1 to 128 UTF-8 bytes')
    expect(() => validate_about_record({ key: sha256_of_address(), value: about_record_vector.record })).toThrow('sha256("about")')
  })

  test('§2.6 [MUST] a receiver rejects an About record that breaks its shape, such as a v1 About envelope', () => {
    for (const value of [
      { ...about_record_vector.record, bio: 'x' },
      { ...about_record_vector.record, avatar: CONTENT },
      { id: ABOUT_KEY, timestamp: 1, v: 1, type: 'about', content: CONTENT }
    ]) {
      expect(() => validate_operation({ payload: { op: 'PUT', key: ABOUT_KEY, value }, library_type: 'recordstore' })).toThrow()
    }
  })

  test('§2.8.1 [MUST] a labels library admits label and About records only', () => {
    const labels = build_labels_put({ set: [[ID, 'a']] })
    const about = build_about_put({ name: 'Mine' })
    expect(validate_operation({ payload: labels, library_type: 'labels' })).toEqual(labels)
    expect(validate_operation({ payload: about, library_type: 'labels' })).toEqual(about)
    const track = { op: 'PUT', key: ID, value: envelope_with({}) }
    const opaque = { op: 'PUT', key: ID, value: { type: 'mixtape', v: 1, timestamp: 1 } }
    for (const payload of [track, opaque]) {
      expect(() => validate_operation({ payload, library_type: 'labels' })).toThrow('does not admit')
    }
    // A recordstore merges the unknown type with no effect instead (§4.4.1).
    expect(validate_operation({ payload: opaque, library_type: 'recordstore' })).toMatchObject({ opaque: true })
  })

  test('§2.7 [MUST] listens entries cannot be deleted', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    const listen = append_listen({ oplog, track_id: ID, address: oplog.chain.address, key_pair: writer })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: listen.hash }) }))
      .toThrow('accepts only listen writes')
    expect(oplog.entries.size).toBe(1)
  })

  test('§2.7 [MUST] a listen write without trackId is rejected', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_listen({ oplog, track_id: '', address: oplog.chain.address, key_pair: writer })).toThrow('requires trackId')
    expect(() => append_entry({ oplog, key_pair: writer, payload: { address: oplog.chain.address, timestamp: 1 } })).toThrow('requires trackId')
    expect(oplog.entries.size).toBe(0)
  })

  test('§2.8.2 [MUST] a recordstore DEL value.type is "track"', () => {
    expect(build_del_operation({ key: ID }).value.type).toBe('track')
    for (const type of ['log', 'labels', 'about', 'listen', 'Track']) {
      const payload = { op: 'DEL', key: ID, value: { type, timestamp: 1 } }
      expect(() => validate_operation({ payload, library_type: 'recordstore' })).toThrow('DEL value.type must be track')
    }
  })

  test('§2.8.2 [MUST] About records are never deleted, and labels are unset rather than deleted', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const about = { op: 'DEL', key: ABOUT_KEY, value: { type: 'about', timestamp: 1 } }
    expect(() => append_entry({ oplog, key_pair: writer, payload: about })).toThrow('About records are never deleted')
    const labels = { op: 'DEL', key: build_labels_put({ set: [[ID, 'a']] }).key, value: { type: 'labels', timestamp: 1 } }
    expect(() => append_entry({ oplog, key_pair: writer, payload: labels })).toThrow('labels are unset')
  })

  test('§2.8.2 [MUST] a labels library rejects any DEL', async () => {
    const { oplog } = await open_test_library({ type: 'labels', writers: [writer] })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: ID }) })).toThrow('admits no DEL')
    const del = forged_block(oplog.chain.address, build_del_operation({ key: ID }))
    expect(merge_entries({ oplog, blocks: [del] }).rejected.map(({ error }) => error.code)).toEqual(['invalid_operation'])
  })

  test('§2.8.2 [MUST] DEL carries no content CID', () => {
    const payload = { op: 'DEL', key: ID, value: { type: 'track', timestamp: 1, content: CONTENT } }
    expect(() => validate_operation({ payload, library_type: 'recordstore' })).toThrow('no content CID')
  })

  test('§2.8.2 [MUST] a received DEL of any other type is rejected at append verification and never reaches the oplog', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const blocks = ['about', 'listen', 'labels'].map((type) =>
      forged_block(oplog.chain.address, { op: 'DEL', key: ID, value: { type, timestamp: 1 } }))
    const { merged, rejected } = merge_entries({ oplog, blocks })
    expect(merged).toEqual([])
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_operation', 'invalid_operation', 'invalid_operation'])
    expect(oplog.entries.size).toBe(0)
  })

  test('§2.8.4 [MUST] a version 1 Log DEL and Log or About envelope from a write-list key merge with no state effect', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const v1 = (type: string) => ({ id: ID, timestamp: 1, v: 1, type, content: 'zb2rhWrAP3dch4trZWGArAEEN8mqFPhsQ2Jojbedxdq8MtCgH' })
    const blocks = [
      forged_block(oplog.chain.address, { op: 'DEL', key: ID, value: { type: 'log', timestamp: 1 } }),
      forged_block(oplog.chain.address, { op: 'PUT', key: ID, value: v1('log') }),
      forged_block(oplog.chain.address, { op: 'PUT', key: ID, value: v1('about') })
    ]
    const { merged, rejected } = merge_entries({ oplog, blocks })
    expect(rejected).toEqual([])
    expect(merged.length).toBe(3)
    expect(merged.every(({ state_keys }) => state_keys.length === 0)).toBe(true)
    expect(oplog.current.size).toBe(0)
  })

  test('§2.8.2 [MUST] a listens-library DEL is rejected on local append', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: ID }) }))
      .toThrow('accepts only listen writes')
  })

  test('§2.8.2 [MUST] a listens-library DEL is rejected on remote merge', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    const listen = forged_block(oplog.chain.address, { trackId: ID, address: oplog.chain.address, timestamp: 1 })
    const del = forged_block(oplog.chain.address, build_del_operation({ key: ID }))
    const put = forged_block(oplog.chain.address, track_put())
    const { merged, rejected } = merge_entries({ oplog, blocks: [listen, del, put] })
    expect(merged.length).toBe(1)
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_operation', 'invalid_operation'])
  })
})
