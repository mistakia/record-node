export type LibraryType = 'recordstore' | 'listens' | 'identity';
export declare const LIBRARY_TYPES: readonly LibraryType[];
export interface BlockStore {
    get: (cid: string) => Promise<Uint8Array | undefined>;
    put: (cid: string, bytes: Uint8Array) => Promise<void>;
}
