// ID derivation (§2.2, §2.3, §2.6, §6.1.4), against src/entry and src/encoding.

import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { sha256_hex } from '#encoding/sha256.ts'
import { validate_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { ABOUT_KEY } from '#entry/records.ts'
import { about_record_vector, sha256_vector, track_envelope_vector as track_vector } from './vectors.ts'

const LOWERCASE_SHA256_HEX = /^[0-9a-f]{64}$/
const CONTENT = track_vector.content

describe('id-derivation', () => {
  test('§2.3.1 [vector] sha256 helper maps "hello" to 2cf24dba…', () => {
    expect(sha256_hex(sha256_vector.input)).toBe(sha256_vector.output_hex)
  })

  test('§2.2 [MUST] envelope id is computed per §2.3', () => {
    expect(compute_track_id(track_vector.id_input)).toBe(track_vector.id)
  })

  test('§2.6 [MUST] the About record key is the sha256 of the UTF-8 string "about"', () => {
    expect(ABOUT_KEY).toBe(sha256_hex('about'))
    expect(ABOUT_KEY).toBe(about_record_vector.operation_key)
  })

  test('§2.2 [MUST] envelope id is lowercase hex', () => {
    expect(compute_track_id('AQAD')).toMatch(LOWERCASE_SHA256_HEX)
    const upper = { id: track_vector.id.toUpperCase(), timestamp: 1, v: 1, type: 'track', content: CONTENT }
    expect(() => validate_envelope(upper)).toThrow('64 lowercase hex')
  })

  test('§2.2 [MUST] envelope id is the plain sha256 hex digest with no prefix, separator, or salt', () => {
    for (const id of [`sha256:${track_vector.id}`, track_vector.id.match(/.{8}/g)?.join('-') ?? '']) {
      expect(() => validate_envelope({ id, timestamp: 1, v: 1, type: 'track', content: CONTENT })).toThrow('64 lowercase hex')
    }
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
