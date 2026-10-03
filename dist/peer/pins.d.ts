import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
export type PinSet = Map<string, boolean>;
export declare const chain_pins: (chain: ResolvedAcChain) => Array<[string, boolean]>;
export declare const entry_pins: ({ content_store, entry }: {
    content_store: ContentStore;
    entry: VerifiedEntry;
}) => Promise<Array<[string, boolean]>>;
export declare const pin_into: ({ content_store, pins, items }: {
    content_store: ContentStore;
    pins: PinSet;
    items: Iterable<[string, boolean]>;
}) => Promise<void>;
