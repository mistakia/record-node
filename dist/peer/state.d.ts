export interface StoredPolicy {
    readonly mode: 'full' | 'selective' | 'index_only';
    readonly filter?: Readonly<Record<string, unknown>>;
}
export interface LibraryState {
    readonly heads: ReadonlyMap<string, readonly string[]>;
    readonly unlinking: ReadonlySet<string>;
    readonly policies: ReadonlyMap<string, StoredPolicy>;
}
export interface LibraryStateStore {
    load: () => Promise<LibraryState>;
    save_heads: (input: {
        library_address: string;
        heads: readonly string[] | undefined;
    }) => Promise<void>;
    set_unlinking: (input: {
        library_address: string;
        unlinking: boolean;
    }) => Promise<void>;
    save_policy: (input: {
        library_address: string;
        policy: StoredPolicy | undefined;
    }) => Promise<void>;
}
export declare const create_memory_state_store: () => LibraryStateStore;
export declare const create_file_state_store: ({ path }: {
    path: string;
}) => LibraryStateStore;
