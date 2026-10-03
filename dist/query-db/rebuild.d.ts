import type { DatabaseSync } from 'node:sqlite';
import type { ResolvedAcChain } from '#access-control/resolve.ts';
import { type Oplog } from '#oplog/dag.ts';
import type { ProtocolError } from '#types/errors.ts';
import { type ContentReader } from './projector.ts';
export interface LibraryReplay {
    readonly chain: ResolvedAcChain;
    readonly blocks: Iterable<Uint8Array>;
}
export interface RebuildResult {
    readonly oplogs: readonly Oplog[];
    readonly rejected: readonly ProtocolError[];
}
export declare const rebuild_query_db: ({ db, libraries, read_content }: {
    db: DatabaseSync;
    libraries: Iterable<LibraryReplay>;
    read_content: ContentReader;
}) => Promise<RebuildResult>;
