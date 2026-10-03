export interface HeadsStore {
    load: () => Promise<ReadonlyMap<string, readonly string[]>>;
    save: (input: {
        library_address: string;
        heads: readonly string[] | undefined;
    }) => Promise<void>;
}
export declare const create_memory_heads_store: () => HeadsStore;
export declare const create_file_heads_store: ({ path }: {
    path: string;
}) => HeadsStore;
