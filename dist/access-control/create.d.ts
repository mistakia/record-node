import type { BlockStore, LibraryType } from '#types/library.ts';
export interface AcChainCids {
    readonly manifest: string;
    readonly wrapper: string;
    readonly write_list: string;
}
export declare const create_ac_chain: ({ name, type, write_keys, block_store }: {
    name: string;
    type: LibraryType;
    write_keys: readonly string[];
    block_store: BlockStore;
}) => Promise<{
    address: string;
    cids: AcChainCids;
}>;
