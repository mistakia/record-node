// Self-check of the fixture port: recomputes every vector in vectors.ts with
// the generator libraries directly, never through src/. These pass from the
// first stage on; the implementation is tested by the section-named stubs.

import { describe, expect, test } from 'bun:test'
import { encode, decode, code as dag_cbor_code } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as create_digest } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'

import {
  TEST_PRIVATE_KEY_HEX,
  TEST_PUBKEY_HEX,
  ENVELOPE_TIMESTAMP,
  NETWORK_MESSAGE_SIZE_BOUND,
  ac_chain_vector,
  build_race_entry,
  child_entry_vector,
  content_cid_vector,
  current_state_vector,
  envelope_vectors,
  heads_message_vector,
  loaded_about_entry_vector,
  sha256_vector,
  signed_entry_vector,
  signing_vector
} from './vectors.ts'

const SHA3_512_CODE = 0x14
const utf8 = (text: string) => new TextEncoder().encode(text)

const sha3_cid = (bytes: Uint8Array) =>
  CID.createV1(dag_cbor_code, create_digest(SHA3_512_CODE, sha3_512(bytes)))

const sign_der = (digest: Uint8Array) => {
  const compact = secp256k1.sign(digest, hexToBytes(TEST_PRIVATE_KEY_HEX))
  return bytesToHex(secp256k1.Signature.fromBytes(compact, 'compact').toBytes('der'))
}

const compare_bytes = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return a.length - b.length
}

describe('fixture port self-check', () => {
  test('F0 §3.4.5 signing vector', () => {
    const public_key = bytesToHex(secp256k1.getPublicKey(hexToBytes(TEST_PRIVATE_KEY_HEX), true))
    expect(public_key).toBe(TEST_PUBKEY_HEX)
    const cbor = encode(signing_vector.unsigned_entry)
    expect(cbor.length).toBe(signing_vector.unsigned_cbor_length)
    expect(bytesToHex(cbor)).toBe(signing_vector.unsigned_cbor_hex)
    const digest = sha256(cbor)
    expect(bytesToHex(digest)).toBe(signing_vector.sha256_digest_hex)
    expect(sign_der(digest)).toBe(signing_vector.signature_der_hex)
  })

  test('F4 §4.1.1 signed-entry CID', () => {
    const signed = { ...signing_vector.unsigned_entry, key: TEST_PUBKEY_HEX, sig: signing_vector.signature_der_hex }
    const cbor = encode(signed)
    expect(cbor.length).toBe(signed_entry_vector.signed_cbor_length)
    expect(sha3_cid(cbor).toString(base58btc)).toBe(signed_entry_vector.entry_hash)
  })

  test('F4 §4.1.2 child entry with non-empty next', () => {
    const cbor = encode(child_entry_vector.unsigned_entry)
    expect(cbor.length).toBe(child_entry_vector.unsigned_cbor_length)
    const digest = sha256(cbor)
    expect(bytesToHex(digest)).toBe(child_entry_vector.sha256_digest_hex)
    const sig = sign_der(digest)
    expect(sig).toBe(child_entry_vector.signature_der_hex)
    const signed_cbor = encode({ ...child_entry_vector.unsigned_entry, key: TEST_PUBKEY_HEX, sig })
    expect(signed_cbor.length).toBe(child_entry_vector.signed_cbor_length)
    expect(sha3_cid(signed_cbor).toString(base58btc)).toBe(child_entry_vector.entry_hash)
    expect(typeof (decode(signed_cbor) as { next: unknown[] }).next[0]).toBe('string')
  })

  test('F1 §2.3.1 sha256 and content CID', () => {
    expect(bytesToHex(sha256(utf8(sha256_vector.input)))).toBe(sha256_vector.output_hex)
    const cbor = encode(content_cid_vector.payload)
    expect(bytesToHex(cbor)).toBe(content_cid_vector.cbor_hex)
    expect(sha3_cid(cbor).toString(base58btc)).toBe(content_cid_vector.cid)
  })

  test.each(envelope_vectors.map((vector) => [vector.type, vector] as const))(
    'F2 §2.2.1 %s envelope',
    (_type, vector) => {
      expect(bytesToHex(sha256(utf8(vector.id_input)))).toBe(vector.id)
      const cbor = encode(vector.payload)
      expect(cbor.length).toBe(vector.payload_cbor_length)
      expect(sha3_cid(cbor).toString(base58btc)).toBe(vector.content)
      const envelope = {
        id: vector.id,
        timestamp: ENVELOPE_TIMESTAMP,
        v: 1,
        type: vector.type,
        content: vector.content,
        ...vector.envelope_extras
      }
      expect(encode(envelope).length).toBe(vector.envelope_cbor_length)
    }
  )

  test('F3 §3.5.1 AC chain and §3.6 address', () => {
    const write_list = encode({ write: ac_chain_vector.write_keys })
    const write_list_cid = sha3_cid(write_list).toString(base58btc)
    expect(write_list.length).toBe(ac_chain_vector.write_list.cbor_length)
    expect(write_list_cid).toBe(ac_chain_vector.write_list.cid)
    const wrapper = encode({ params: { address: write_list_cid }, type: 'static' })
    const wrapper_cid = sha3_cid(wrapper).toString(base58btc)
    expect(wrapper.length).toBe(ac_chain_vector.wrapper.cbor_length)
    expect(wrapper_cid).toBe(ac_chain_vector.wrapper.cid)
    const manifest = encode({
      name: ac_chain_vector.library_name,
      type: ac_chain_vector.library_type,
      accessController: wrapper_cid
    })
    const manifest_cid = sha3_cid(manifest).toString(base58btc)
    expect(manifest.length).toBe(ac_chain_vector.manifest.cbor_length)
    expect(manifest_cid).toBe(ac_chain_vector.manifest.cid)
    expect(`/record/${manifest_cid}/${ac_chain_vector.library_name}`).toBe(ac_chain_vector.library_address)
  })

  test('F5 §4.4.2 current-state race set', () => {
    const entries = current_state_vector.entries.map((vector) => {
      const cid = sha3_cid(encode(build_race_entry(vector)))
      expect(cid.toString(base58btc)).toBe(vector.entry_hash)
      return { ...vector, multihash: cid.multihash.bytes }
    })
    const sorted = [...entries].sort((a, b) =>
      b.clock_time - a.clock_time ||
      b.envelope_timestamp - a.envelope_timestamp ||
      compare_bytes(a.multihash, b.multihash))
    expect(sorted[0]?.tag).toBe(current_state_vector.winner)
  })

  test('F6 §5.3.2 LoadedAboutEntry and §5.4.1 heads message', () => {
    const { message } = loaded_about_entry_vector
    expect<string>(message.payload.key).toBe(bytesToHex(sha256(utf8(ac_chain_vector.library_address))))
    const json = JSON.stringify(message)
    expect(Buffer.byteLength(json)).toBe(loaded_about_entry_vector.json_byte_length)
    expect(JSON.parse(json)).toEqual(message)
    expect(Buffer.byteLength(heads_message_vector.json)).toBe(heads_message_vector.json_byte_length)
    expect(heads_message_vector.json_byte_length).toBeLessThanOrEqual(NETWORK_MESSAGE_SIZE_BOUND)
  })
})
