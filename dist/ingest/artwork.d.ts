import type { ContentStore } from '#fabric/content-store.ts';
export declare const upload_artwork: ({ pictures, content_store }: {
    pictures: ReadonlyArray<{
        readonly data: Uint8Array;
    }>;
    content_store: ContentStore;
}) => Promise<string[]>;
