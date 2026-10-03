// Node smoke for §3.4.4 verification, run with `node test/smoke/signature-node.ts`.
// Under Node, OpenSSL does the curve arithmetic; Bun's tests only ever run
// noble. Every verdict here must equal noble's, for the spec vectors and for
// valid, high-S, tampered, mismatched, and malformed signatures.

import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { signing_digest, sign_entry } from '#identity/signing.ts'
import { signature_backend, verify_entry_signature } from '#identity/verification.ts'
import { child_entry_vector, signing_vector, TEST_PUBKEY_HEX } from '#test/conformance/vectors.ts'
import type { SignedEntry } from '#types/entry.ts'

assert.equal(signature_backend, 'openssl')

const noble_verdict = (entry: SignedEntry): boolean => {
  try {
    return secp256k1.verify(hexToBytes(entry.sig), signing_digest(entry), hexToBytes(entry.key), { format: 'der', lowS: false })
  } catch {
    return false
  }
}

let checked = 0
const agree = (entry: SignedEntry, expected?: boolean) => {
  const verdict = verify_entry_signature({ entry })
  assert.equal(verdict, noble_verdict(entry), `verdicts differ for sig ${entry.sig} under key ${entry.key}`)
  if (expected !== undefined) assert.equal(verdict, expected)
  checked += 1
}

for (const vector of [signing_vector, child_entry_vector]) {
  agree({ ...vector.unsigned_entry, key: TEST_PUBKEY_HEX, sig: vector.signature_der_hex } as unknown as SignedEntry, true)
}

const high_s = (sig: string): string => {
  const { r, s } = secp256k1.Signature.fromBytes(hexToBytes(sig), 'der')
  return bytesToHex(new secp256k1.Signature(r, secp256k1.Point.CURVE().n - s).toBytes('der'))
}

const signed = Array.from({ length: 100 }, (_, i) => {
  const private_key = secp256k1.utils.randomSecretKey()
  const unsigned_entry = { ...signing_vector.unsigned_entry, clock: { ...signing_vector.unsigned_entry.clock, time: i + 1 } }
  return sign_entry({ unsigned_entry, private_key } as never)
})

for (const [i, entry] of signed.entries()) {
  const other = signed[(i + 1) % signed.length] as SignedEntry
  agree(entry, true)
  agree({ ...entry, sig: high_s(entry.sig) }, true)
  agree({ ...entry, clock: { ...entry.clock, time: entry.clock.time + 1000 } }, false)
  agree({ ...entry, sig: other.sig }, false)
  agree({ ...entry, key: other.key }, false)
  agree({ ...entry, sig: `${entry.sig}00` })
  agree({ ...entry, sig: entry.sig.slice(0, -2) })
  agree({ ...entry, sig: bytesToHex(randomBytes(71)) }, false)
}

console.log(`node ${process.version}: signature smoke passed, ${checked} verdicts equal noble's under ${signature_backend}`)
