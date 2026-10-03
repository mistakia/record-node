import type { BlockStore } from '#types/library.ts';
export declare const CONTENT_IMPORT_PROFILE = "unixfs-v1-2025";
export type BlobSource = string | Uint8Array | AsyncIterable<Uint8Array>;
export interface PinOptions {
    readonly recursive?: boolean;
}
export interface ContentStore extends BlockStore {
    get: (cid: string) => Promise<Uint8Array | undefined>;
    put: (cid: string, bytes: Uint8Array) => Promise<void>;
    has: (cid: string) => Promise<boolean>;
    pin: (cid: string, options?: PinOptions) => Promise<void>;
    unpin: (cid: string) => Promise<void>;
    is_pinned: (cid: string) => Promise<boolean>;
    import_blob: (source: BlobSource) => Promise<string>;
}
