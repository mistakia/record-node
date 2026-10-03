// AC chain creation: write-list, then AC wrapper, then manifest (§3.5.1, §3.6, §3.7).
import { build_ac_chain, validate_library_name } from '#encoding/library-address.ts';
import { validate_compressed_pubkey } from '#identity/key-pair.ts';
export const create_ac_chain = async ({ name, type, write_keys, block_store }) => {
    validate_library_name(name);
    const { address, write_list, wrapper, manifest } = build_ac_chain({ name, type, write_keys: write_keys.map(validate_compressed_pubkey) });
    for (const { cid, bytes } of [write_list, wrapper, manifest])
        await block_store.put(cid, bytes);
    return { address, cids: { manifest: manifest.cid, wrapper: wrapper.cid, write_list: write_list.cid } };
};
