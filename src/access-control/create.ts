// AC chain creation: write-list, then AC wrapper, then manifest (§3.5.1, §3.6, §3.7).

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { build_library_address, validate_library_name } from '#encoding/library-address.ts'
import { validate_compressed_pubkey } from '#identity/key-pair.ts'
import type { BlockStore, LibraryType } from '#types/library.ts'

export interface AcChainCids {
  readonly manifest: string
  readonly wrapper: string
  readonly write_list: string
}

const put_object = async ({ block_store, value }: { block_store: BlockStore, value: unknown }) => {
  const bytes = encode_canonical(value)
  const cid = compute_cid_string(bytes)
  await block_store.put(cid, bytes)
  return cid
}

export const create_ac_chain = async ({ name, type, write_keys, block_store }: {
  name: string
  type: LibraryType
  write_keys: readonly string[]
  block_store: BlockStore
}): Promise<{ address: string, cids: AcChainCids }> => {
  validate_library_name(name)
  const write = write_keys.map(validate_compressed_pubkey)
  const write_list = await put_object({ block_store, value: { write } })
  const wrapper = await put_object({ block_store, value: { params: { address: write_list }, type: 'static' } })
  const manifest = await put_object({ block_store, value: { name, type, accessController: wrapper } })
  return { address: build_library_address({ manifest_cid: manifest, name }), cids: { manifest, wrapper, write_list } }
}
