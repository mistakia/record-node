import type { DatabaseSync } from 'node:sqlite';
import type { createHeliaLight, Helia } from 'helia';
import type { ContentStore } from '#fabric/content-store.ts';
import type { CommitBatcher } from '#fabric/commit-batch.ts';
type RawBlockstore = NonNullable<NonNullable<Parameters<typeof createHeliaLight>[0]>['blockstore']>;
export declare const create_helia_content_store: ({ helia, blockstore, pin_db, commit }: {
    helia: Helia;
    blockstore: RawBlockstore;
    pin_db: DatabaseSync;
    commit?: CommitBatcher | undefined;
}) => ContentStore;
export {};
