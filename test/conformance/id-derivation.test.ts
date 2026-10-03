// ID derivation (§2.2, §2.3, §6.1.4), against src/entry and src/encoding.

import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { sha256_hex } from '#encoding/sha256.ts'
import { build_about_envelope, build_log_envelope, validate_envelope } from '#entry/envelope.ts'
import { compute_about_id, compute_log_id, compute_track_id } from '#entry/id.ts'
import { envelope_vectors, sha256_vector } from './vectors.ts'

const LOWERCASE_SHA256_HEX = /^[0-9a-f]{64}$/
const [track_vector, log_vector, about_vector] = envelope_vectors
const ADDRESS = about_vector.id_input
const CONTENT = about_vector.content

describe('id-derivation', () => {
  test('§2.3.1 [vector] sha256 helper maps "hello" to 2cf24dba…', () => {
    expect(sha256_hex(sha256_vector.input)).toBe(sha256_vector.output_hex)
  })

  test('§2.2 [MUST] envelope id is computed per §2.3 for its type', () => {
    expect(compute_track_id(track_vector.id_input)).toBe(track_vector.id)
    expect(compute_log_id(log_vector.id_input)).toBe(log_vector.id)
    expect(compute_about_id(about_vector.id_input)).toBe(about_vector.id)
  })

  test('§2.2 [MUST] envelope id is lowercase hex', () => {
    for (const id of [compute_track_id('AQAD'), compute_log_id(ADDRESS), compute_about_id(ADDRESS)]) {
      expect(id).toMatch(LOWERCASE_SHA256_HEX)
    }
    const upper = { id: about_vector.id.toUpperCase(), timestamp: 1, v: 1, type: 'about', content: CONTENT }
    expect(() => validate_envelope(upper)).toThrow('64 lowercase hex')
  })

  test('§2.2 [MUST] envelope id is the plain sha256 hex digest with no prefix, separator, or salt', () => {
    expect(compute_log_id(ADDRESS)).toBe(bytesToHex(sha256(new TextEncoder().encode(ADDRESS))))
    for (const id of [`sha256:${about_vector.id}`, about_vector.id.match(/.{8}/g)?.join('-') ?? '']) {
      expect(() => validate_envelope({ id, timestamp: 1, v: 1, type: 'about', content: CONTENT })).toThrow('64 lowercase hex')
    }
  })

  test('§2.3 [MUST] log and about ids hash the exact library address including /record/ and /<name>', () => {
    const without_prefix = ADDRESS.slice('/record/'.length)
    const without_name = ADDRESS.slice(0, ADDRESS.lastIndexOf('/'))
    expect(compute_about_id(ADDRESS)).toBe(sha256_hex(ADDRESS))
    expect(compute_about_id(ADDRESS)).not.toBe(sha256_hex(without_prefix))
    expect(compute_about_id(ADDRESS)).not.toBe(sha256_hex(without_name))
  })

  test('§2.3 [MUST] log and about entries are told apart by envelope type, not by id', () => {
    const log = build_log_envelope({ id: compute_log_id(ADDRESS), content_cid: CONTENT, timestamp: 1 })
    const about = build_about_envelope({ id: compute_about_id(ADDRESS), content_cid: CONTENT, timestamp: 1 })
    expect(log.id).toBe(about.id)
    expect(validate_envelope(log).type).toBe('log')
    expect(validate_envelope(about).type).toBe('about')
  })

  test('§6.1.4 [MUST] track id hashes the fingerprint string, not its decoded bytes', () => {
    const fingerprint = track_vector.id_input
    const decoded = Uint8Array.from(atob(fingerprint.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
    expect(compute_track_id(fingerprint)).toBe(sha256_hex(fingerprint))
    expect(compute_track_id(fingerprint)).not.toBe(bytesToHex(sha256(decoded)))
  })

  test('§6.1.4 [MUST] track id is lowercase hex', () => {
    expect(compute_track_id(track_vector.id_input)).toMatch(LOWERCASE_SHA256_HEX)
  })
})
