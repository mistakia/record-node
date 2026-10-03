// Degenerate fingerprints (§6.1.6), against src/ingest/fingerprint.ts and the
// F11 vector.

import { describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { decode_fingerprint, is_degenerate_fingerprint } from '#ingest/fingerprint.ts'
import { audio_pipeline_vector as f7, degenerate_fingerprint_vector as f11 } from './vectors.ts'

// The generator's encoder, the inverse of the decoder, for the threshold pair.
const encode_fingerprint = (values: readonly number[], algorithm = 1): string => {
  const normal: number[] = []
  const exceptions: number[] = []
  let previous = 0
  for (const value of values) {
    let xor = (value ^ previous) >>> 0
    let position = 1
    let last_bit = 0
    while (xor !== 0) {
      if ((xor & 1) === 1) {
        const delta = position - last_bit
        if (delta >= 7) {
          normal.push(7)
          exceptions.push(delta - 7)
        } else {
          normal.push(delta)
        }
        last_bit = position
      }
      xor >>>= 1
      position++
    }
    normal.push(0)
    previous = value
  }
  const pack = (items: number[], width: number) => {
    const out = Buffer.alloc(Math.ceil((items.length * width) / 8))
    let bit = 0
    for (const item of items) {
      for (let k = 0; k < width; k++, bit++) if (((item >> k) & 1) === 1) out[bit >> 3] = (out[bit >> 3] ?? 0) | (1 << (bit & 7))
    }
    return out
  }
  const n = values.length
  const header = Buffer.from([algorithm, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  return Buffer.concat([header, pack(normal, 3), pack(exceptions, 5)]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const summary = (fingerprint: string) => {
  const { values } = decode_fingerprint(fingerprint)
  return { values: values.length, distinct: new Set(values).size }
}

describe('degenerate-fingerprint', () => {
  test('§6.1.6 [vector] F11 the silence fingerprint is one value repeated, and degenerate', () => {
    expect(summary(f11.silence.fingerprint)).toEqual({ values: f11.silence.values, distinct: f11.silence.distinct })
    expect(compute_track_id(f11.silence.fingerprint)).toBe(f11.silence.track_id)
    expect(is_degenerate_fingerprint(f11.silence.fingerprint)).toBe(true)
  })

  test('§6.1.6 [vector] F11 the v1.0 sine is degenerate; the v1.1 chirp and music are not', () => {
    expect(summary(f11.sine.fingerprint)).toEqual({ values: f11.sine.values, distinct: f11.sine.distinct })
    expect(compute_track_id(f11.sine.fingerprint)).toBe(f11.sine.track_id)
    expect(is_degenerate_fingerprint(f11.sine.fingerprint)).toBe(true)
    expect(summary(f7.fingerprint)).toEqual({ values: 59, distinct: 59 })
    expect(is_degenerate_fingerprint(f7.fingerprint)).toBe(false)
    expect(summary(f11.music.fingerprint)).toEqual({ values: f11.music.values, distinct: f11.music.distinct })
    expect(is_degenerate_fingerprint(f11.music.fingerprint)).toBe(false)
  })

  test('§6.1.6 [vector] F11 the decoder inverts the generator encoder on every literal string', () => {
    for (const fingerprint of [f11.silence.fingerprint, f11.sine.fingerprint, f11.music.fingerprint, f7.fingerprint]) {
      const { algorithm, values } = decode_fingerprint(fingerprint)
      expect(encode_fingerprint(values, algorithm)).toBe(fingerprint)
    }
  })

  test('§6.1.6 [MUST] degenerate when one value fills at least 19 in 20 positions', () => {
    const [silence_value] = decode_fingerprint(f11.silence.fingerprint).values
    const equal_of_20 = (k: number) => [...Array<number>(k).fill(silence_value as number), ...Array.from({ length: 20 - k }, (_, i) => 0x10000 + i)]
    expect(is_degenerate_fingerprint(encode_fingerprint(equal_of_20(19)))).toBe(true)
    expect(is_degenerate_fingerprint(encode_fingerprint(equal_of_20(18)))).toBe(false)
    expect(is_degenerate_fingerprint(encode_fingerprint([]))).toBe(true)
  })
})
