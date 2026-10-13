// The fast base58btc codec against multiformats' generic one, and the
// protocol-CID check against parse_cid, on random and mutated inputs.

import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { base58btc } from 'multiformats/bases/base58'

import { decode_base58btc, encode_base58btc } from '#encoding/base58.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid, compute_cid_string, is_protocol_cid, parse_cid } from '#encoding/cid.ts'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const parses = (value: string): boolean => {
  try {
    parse_cid(value)
    return true
  } catch {
    return false
  }
}

describe('base58btc', () => {
  test('encodes and decodes as multiformats does, leading zero bytes included', () => {
    for (let round = 0; round < 3000; round++) {
      const bytes = randomBytes(round % 90)
      if (round % 7 === 0) bytes.fill(0, 0, Math.min(bytes.length, round % 5))
      const text = base58btc.baseEncode(bytes)
      expect(encode_base58btc(bytes)).toBe(text)
      expect(decode_base58btc(text)).toEqual(new Uint8Array(bytes))
    }
  })

  test('refuses a character outside the alphabet', () => {
    for (const text of ['0', 'O', 'I', 'l', 'abc+', 'é']) expect(decode_base58btc(text)).toBeUndefined()
  })

  test('a protocol CID string is accepted exactly when parse_cid accepts it', () => {
    for (let round = 0; round < 500; round++) {
      const cid = compute_cid_string(encode_canonical({ round }))
      expect(cid).toBe(compute_cid(encode_canonical({ round })).toString(base58btc))
      const index = 1 + (round % (cid.length - 1))
      const mutated = [
        cid,
        cid.slice(0, index) + (ALPHABET[(ALPHABET.indexOf(cid[index] as string) + 1 + round) % 58] as string) + cid.slice(index + 1),
        cid.slice(0, index) + cid.slice(index + 1),
        `${cid}${ALPHABET[round % 58] as string}`,
        `z1${cid.slice(1)}`,
        cid.slice(1),
        `Q${cid.slice(1)}`,
        `z${base58btc.baseEncode(randomBytes(68))}`
      ]
      for (const value of mutated) expect([value, is_protocol_cid(value)]).toEqual([value, parses(value)])
    }
  })
})
