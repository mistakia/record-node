import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
export type PinSet = Map<string, boolean>;
export declare const chain_pins: (chain: ResolvedAcChain) => Array<[string, boolean]>;
export type KeepsBlobs = (input: {
    entry: VerifiedEntry;
    content: Record<string, unknown>;
}) => boolean;
export declare const stored_track_content: ({ content_store, content_cid }: {
    content_store: ContentStore;
    content_cid: string;
}) => Promise<Record<string, unknown> | undefined>;
export declare const track_blobs: (content: Record<string, unknown>) => string[];
export declare const has_item_6: (entry: VerifiedEntry) => boolean;
export declare const stored_item_6: ({ content_store, library_address, entry }: {
    content_store: ContentStore;
    library_address: string;
    entry: VerifiedEntry;
}) => Promise<{
    content: Record<string, unknown>;
    blobs: string[];
} | undefined>;
export declare const entry_pins: ({ content_store, library_address, entry, keeps_blobs }: {
    content_store: ContentStore;
    library_address: string;
    entry: VerifiedEntry;
    keeps_blobs: KeepsBlobs;
}) => Promise<Array<[string, boolean]>>;
export declare const pin_into: ({ content_store, pins, items }: {
    content_store: ContentStore;
    pins: PinSet;
    items: Iterable<[string, boolean]>;
}) => Promise<void>;
