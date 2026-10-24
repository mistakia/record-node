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
import { importer } from 'ipfs-unixfs-importer'
import { readFileSync } from 'node:fs'

import {
  TEST_PRIVATE_KEY_HEX,
  TEST_PUBKEY_HEX,
  ENVELOPE_TIMESTAMP,
  NETWORK_MESSAGE_SIZE_BOUND,
  about_record_vector,
  ac_chain_vector,
  announced_about_vector,
  audio_pipeline_vector,
  build_multi_block_input,
  build_race_entry,
  child_entry_vector,
  content_cid_vector,
  current_state_vector,
  heads_message_vector,
  label_vector,
  multi_block_vector,
  sha256_vector,
  signed_entry_vector,
  signing_vector,
  track_envelope_vector
} from './vectors.ts'

const SHA3_512_CODE = 0x14
const utf8 = (text: string) => new TextEncoder().encode(text)

// The generator's import: the profile alone, blocks discarded.
const profile_cid = async (bytes: Uint8Array) => {
  let root
  for await (const { cid } of importer([{ content: bytes }], { put: async (cid) => cid }, { profile: 'unixfs-v1-2025' })) root = cid
  return root?.toString(base58btc)
}

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

  test('F2 §2.2.1 track envelope', () => {
    const vector = track_envelope_vector
    expect(bytesToHex(sha256(utf8(vector.id_input)))).toBe(vector.id)
    const cbor = encode(vector.payload)
    expect(cbor.length).toBe(vector.payload_cbor_length)
    expect(sha3_cid(cbor).toString(base58btc)).toBe(vector.content)
    const envelope = { id: vector.id, timestamp: ENVELOPE_TIMESTAMP, v: 1, type: 'track', content: vector.content }
    expect(bytesToHex(encode(envelope))).toBe(vector.envelope_cbor_hex)
  })

  test('F2 §2.6 About record', () => {
    expect(bytesToHex(encode(about_record_vector.record))).toBe(about_record_vector.record_cbor_hex)
    expect(bytesToHex(sha256(utf8('about')))).toBe(about_record_vector.operation_key)
  })

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

  test('F6 §5.3.2 announced About entry and §5.4.1 heads message', () => {
    const { entry, entry_hash } = announced_about_vector
    expect(entry.payload.key).toBe(about_record_vector.operation_key)
    const { key: _key, sig, ...unsigned } = entry
    expect(sign_der(sha256(encode(unsigned)))).toBe(sig)
    expect(sha3_cid(encode(entry)).toString(base58btc)).toBe(entry_hash)
    expect(Buffer.byteLength(heads_message_vector.json)).toBe(heads_message_vector.json_byte_length)
    expect(heads_message_vector.json_byte_length).toBeLessThanOrEqual(NETWORK_MESSAGE_SIZE_BOUND)
  })

  test('F7 §5.5.1 audio and multi-block import CIDs', async () => {
    const audio = readFileSync(audio_pipeline_vector.fixture_path)
    expect(bytesToHex(sha256(utf8(audio_pipeline_vector.fingerprint)))).toBe(audio_pipeline_vector.track_id)
    expect(bytesToHex(sha256(audio))).toBe(audio_pipeline_vector.audio_identity_sha256)
    expect(await profile_cid(audio)).toBe(audio_pipeline_vector.audio_cid)
    expect(await profile_cid(build_multi_block_input())).toBe(multi_block_vector.cid)
  })

  test('F12 §2.5 label record keys, entry hashes, and per-pair state', () => {
    const hashes = new Map<string, string>()
    const named = new Map<string, Record<string, unknown>>()
    for (const vector of label_vector.entries) {
      const next = vector.next.map((name) => hashes.get(name) as string)
      const time = next.length === 0 ? 1 : Math.max(...vector.next.map((name) => (named.get(name)?.clock as { time: number }).time)) + 1
      const payload = 'record' in vector
        ? { op: 'PUT', key: vector.key, value: { type: 'labels', v: 1, ...vector.record } }
        : { op: 'DEL', key: vector.del.key, value: { type: 'track', timestamp: vector.del.timestamp } }
      if ('record' in vector) expect(bytesToHex(sha256(encode(payload.value)))).toBe(vector.key)
      const unsigned = { id: ac_chain_vector.library_address, payload, next, refs: [], v: 2, clock: { id: TEST_PUBKEY_HEX, time } }
      const signed = { ...unsigned, key: TEST_PUBKEY_HEX, sig: sign_der(sha256(encode(unsigned))) }
      expect(sha3_cid(encode(signed)).toString(base58btc)).toBe(vector.entry_hash)
      hashes.set(vector.name, vector.entry_hash)
      named.set(vector.name, signed)
    }
    // Per pair, the record greatest under §4.4.2 among those naming it decides.
    const multihash = (hash: string) => CID.parse(hash, base58btc).multihash.bytes
    const records = label_vector.entries.flatMap((vector) => 'record' in vector ? [vector] : [])
    const time_of = (name: string) => (named.get(name)?.clock as { time: number }).time
    const state = label_vector.label_state.map(({ track_id, label }) => {
      const naming = records.flatMap((vector) => [
        ...vector.record.set.filter(([t, l]) => t === track_id && l === label).map(() => ({ vector, applied: true })),
        ...vector.record.unset.filter(([t, l]) => t === track_id && l === label).map(() => ({ vector, applied: false }))
      ]).sort((a, b) => time_of(b.vector.name) - time_of(a.vector.name) || b.vector.record.timestamp - a.vector.record.timestamp ||
        compare_bytes(multihash(a.vector.entry_hash), multihash(b.vector.entry_hash)))
      return { track_id, label, applied: naming[0]?.applied ?? false }
    })
    expect(state).toEqual(label_vector.label_state.map((pair) => ({ ...pair })))
  })
})
