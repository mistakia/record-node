import type { ContentStore } from '#fabric/content-store.ts';
export declare const load_entry_blocks: ({ heads, content_store }: {
    heads: Iterable<string>;
    content_store: ContentStore;
}) => Promise<Uint8Array[]>;
