// Signature verification (§3.4.4).

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import type { SignedEntry } from '#types/entry.ts'
import { signing_digest } from './signing.ts'

// Any valid ECDSA signature verifies: the spec does not require low-S, so
// rejecting high-S would split peers on an otherwise valid entry.
export const verify_entry_signature = ({ entry }: { entry: SignedEntry }): boolean => {
  try {
    return secp256k1.verify(hexToBytes(entry.sig), signing_digest(entry), hexToBytes(entry.key), {
      format: 'der',
      lowS: false
    })
  } catch {
    return false
  }
}
