// AC chain resolution from a library address (§3.5.1 procedure, §3.5.2).

import { decode_canonical } from '#encoding/canonical-bytes.ts'
import { parse_library_address } from '#encoding/library-address.ts'
import { is_compressed_pubkey } from '#identity/key-pair.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import type { CompressedPubkeyHex } from '#types/identity.ts'
import { LIBRARY_TYPES, type BlockStore, type LibraryType } from '#types/library.ts'
import type { AcChainCids } from './create.ts'

declare const resolved_chain_brand: unique symbol

// A verified AC chain. Constructible only by resolve_ac_chain, and the oplog
// takes nothing else, so no library proceeds without one.
export type ResolvedAcChain = {
  readonly address: string
  readonly name: string
  readonly type: LibraryType
  readonly write_list: readonly CompressedPubkeyHex[]
  readonly cids: AcChainCids
} & { readonly [resolved_chain_brand]: true }

const reject = (message: string) => new ProtocolError('library_rejected', message)

const has_exact_fields = (value: Record<string, unknown>, fields: readonly string[]) => {
  const keys = Object.keys(value)
  return keys.length === fields.length && fields.every((field) => keys.includes(field))
}

const fetch_object = async ({ block_store, cid, label }: { block_store: BlockStore, cid: string, label: string }) => {
  let bytes: Uint8Array | undefined
  try {
    bytes = await block_store.get(cid)
  } catch {
    bytes = undefined
  }
  if (bytes === undefined) throw new ProtocolError('library_unopenable', `${label} ${cid} could not be fetched`)
  try {
    return decode_canonical(bytes).value
  } catch {
    throw reject(`${label} ${cid} does not decode as canonical dag-cbor`)
  }
}

export const resolve_ac_chain = async ({ library_address, block_store }: {
  library_address: string
  block_store: BlockStore
}): Promise<ResolvedAcChain> => {
  const { manifest_cid, name } = parse_library_address(library_address)

  const manifest = await fetch_object({ block_store, cid: manifest_cid, label: 'manifest' })
  if (!is_record(manifest) || !has_exact_fields(manifest, ['name', 'type', 'accessController']) ||
    typeof manifest.name !== 'string' || !LIBRARY_TYPES.includes(manifest.type as LibraryType) ||
    typeof manifest.accessController !== 'string') {
    throw reject('manifest does not match {name, type, accessController}')
  }
  if (manifest.name !== name) throw reject(`manifest name ${manifest.name} differs from address name ${name}`)

  const wrapper = await fetch_object({ block_store, cid: manifest.accessController, label: 'AC wrapper' })
  if (!is_record(wrapper) || !has_exact_fields(wrapper, ['params', 'type']) || typeof wrapper.type !== 'string' ||
    !is_record(wrapper.params) || !has_exact_fields(wrapper.params, ['address']) || typeof wrapper.params.address !== 'string') {
    throw reject('AC wrapper does not match {params: {address}, type}')
  }
  // Only "static" exists in v1; anything else refuses open, replicate, and append (§3.5.2).
  if (wrapper.type !== 'static') throw new ProtocolError('unsupported_ac_type', `unrecognised AC type ${wrapper.type}`)

  const write_list = await fetch_object({ block_store, cid: wrapper.params.address, label: 'write-list' })
  if (!is_record(write_list) || !has_exact_fields(write_list, ['write']) || !Array.isArray(write_list.write)) {
    throw reject('write-list does not match {write: [...]}')
  }
  if (!write_list.write.every(is_compressed_pubkey)) throw reject('a write-list element is not a compressed pubkey hex')

  return Object.freeze({
    address: library_address,
    name,
    type: manifest.type as LibraryType,
    write_list: Object.freeze([...write_list.write]),
    cids: { manifest: manifest_cid, wrapper: manifest.accessController, write_list: wrapper.params.address }
  }) as ResolvedAcChain
}
