// Chromaprint fingerprinting through fpcalc (§6.1), and the decode of a
// fingerprint string into its subfingerprint values for the §6.1.6
// degeneracy rule.

import { IngestError } from '#types/ingest.ts'
import { run_tool } from './subprocess.ts'
import type { Toolchain } from './toolchain.ts'

// Algorithm 2 is requested explicitly whatever the tool default, and nothing
// else that shapes the fingerprint (sample-rate scaling, -length) is passed
// (§6.1.2). -json only selects the output format.
export const FPCALC_ARGS = ['-json', '-algorithm', '2'] as const

const rejection = ({ stderr, exit_code }: { stderr: string, exit_code: number }): IngestError => {
  const message = stderr.trim() || `fpcalc exited ${exit_code}`
  if (/empty fingerprint/i.test(message)) return new IngestError('empty_fingerprint', message)
  if (/audio stream|invalid data/i.test(message)) return new IngestError('no_audio', message)
  return new IngestError('tool_failed', message)
}

// Takes the original file. Callers must never pass the tag-stripped copy
// (§6.1.2.1): the fingerprint is computed before tag stripping runs. An empty
// fingerprint, an error exit, or no decodable audio rejects the ingest
// (§6.4.1 step 1), so sha256("") never becomes a track id.
export const compute_fingerprint = async ({ file_path, toolchain }: {
  file_path: string
  toolchain: Toolchain
}): Promise<string> => {
  const { exit_code, stdout, stderr } = await run_tool({ command: toolchain.fpcalc_path, args: [...FPCALC_ARGS, file_path] })
  if (exit_code !== 0) throw rejection({ stderr, exit_code })
  let fingerprint: unknown
  try {
    fingerprint = (JSON.parse(stdout) as { fingerprint?: unknown }).fingerprint
  } catch {
    throw new IngestError('tool_failed', `fpcalc printed no JSON for ${file_path}`)
  }
  if (typeof fingerprint !== 'string') throw new IngestError('tool_failed', `fpcalc printed no fingerprint for ${file_path}`)
  if (fingerprint.length === 0) throw new IngestError('empty_fingerprint', `fpcalc produced an empty fingerprint for ${file_path}`)
  return fingerprint
}

const base64url_bytes = (fingerprint: string): Uint8Array =>
  Uint8Array.from(Buffer.from(fingerprint.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))

// Chromaprint's compressed format: an algorithm byte, a 24-bit big-endian
// value count, 3-bit packed deltas between the set bits of each value's XOR
// with its predecessor (0 ends a value, 7 defers to the next 5-bit
// exception), then the exceptions.
export const decode_fingerprint = (fingerprint: string): { algorithm: number, values: number[] } => {
  const bytes = base64url_bytes(fingerprint)
  if (bytes.length < 4) throw new IngestError('tool_failed', 'fingerprint is shorter than its header')
  const [algorithm = 0, b1 = 0, b2 = 0, b3 = 0] = bytes
  const count = (b1 << 16) | (b2 << 8) | b3
  const body = bytes.subarray(4)
  const read = (position: number, width: number) => {
    let value = 0
    for (let bit = 0; bit < width; bit++) value |= (((body[(position + bit) >> 3] ?? 0) >> ((position + bit) & 7)) & 1) << bit
    return value
  }
  const normal: number[] = []
  let position = 0
  for (let ends = 0; ends < count;) {
    if (position + 3 > body.length * 8) throw new IngestError('tool_failed', 'fingerprint is truncated')
    const value = read(position, 3)
    position += 3
    normal.push(value)
    if (value === 0) ends++
  }
  let exception = Math.ceil(position / 8) * 8
  const values: number[] = []
  let previous = 0
  let xor = 0
  let last_bit = 0
  for (let delta of normal) {
    if (delta === 7) {
      delta += read(exception, 5)
      exception += 5
    }
    if (delta === 0) {
      previous = (previous ^ xor) >>> 0
      values.push(previous)
      xor = 0
      last_bit = 0
    } else {
      last_bit += delta
      xor = (xor | (1 << (last_bit - 1))) >>> 0
    }
  }
  return { algorithm, values }
}

// §6.1.6: empty, or one value filling at least 19 in 20 positions, as a
// silent or steady-tone window yields.
export const is_degenerate_fingerprint = (fingerprint: string): boolean => {
  const { values } = decode_fingerprint(fingerprint)
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const most_common = Math.max(0, ...counts.values())
  return values.length === 0 || 20 * most_common >= 19 * values.length
}
