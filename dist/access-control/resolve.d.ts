import type { CompressedPubkeyHex } from '#types/identity.ts';
import { type BlockStore, type LibraryType } from '#types/library.ts';
import type { AcChainCids } from './create.ts';
declare const resolved_chain_brand: unique symbol;
export type ResolvedAcChain = {
    readonly address: string;
    readonly name: string;
    readonly type: LibraryType;
    readonly write_list: readonly CompressedPubkeyHex[];
    readonly cids: AcChainCids;
} & {
    readonly [resolved_chain_brand]: true;
};
export declare const resolve_ac_chain: ({ library_address, block_store }: {
    library_address: string;
    block_store: BlockStore;
}) => Promise<ResolvedAcChain>;
export {};
