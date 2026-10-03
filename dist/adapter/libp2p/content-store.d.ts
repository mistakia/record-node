import type { createHeliaLight, Helia } from 'helia';
import type { ContentStore } from '#fabric/content-store.ts';
type RawBlockstore = NonNullable<NonNullable<Parameters<typeof createHeliaLight>[0]>['blockstore']>;
export declare const create_helia_content_store: ({ helia, blockstore }: {
    helia: Helia;
    blockstore: RawBlockstore;
}) => ContentStore;
export {};
