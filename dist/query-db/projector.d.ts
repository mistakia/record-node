import type { DatabaseSync } from 'node:sqlite';
import type { VerifiedEntry } from '#oplog/accept.ts';
import type { Oplog } from '#oplog/dag.ts';
import type { CommitBatcher } from '#fabric/commit-batch.ts';
export type ContentReader = (cid: string) => Promise<Uint8Array | undefined>;
export interface Projector {
    project_entries: (input: {
        oplog: Oplog;
        entries: readonly VerifiedEntry[];
        keys?: Iterable<string>;
    }) => Promise<void>;
    project_keys: (input: {
        oplog: Oplog;
        keys: Iterable<string>;
    }) => Promise<void>;
    project_library: (input: {
        oplog: Oplog;
    }) => Promise<void>;
    remove_library: (input: {
        library_address: string;
    }) => Promise<void>;
    projection_state: (input: {
        library_address: string;
    }) => Promise<{
        heads: readonly string[];
        pending: readonly string[];
    } | undefined>;
}
export declare const create_projector: ({ db, read_content, commit }: {
    db: DatabaseSync;
    read_content: ContentReader;
    commit?: CommitBatcher | undefined;
}) => Projector;
