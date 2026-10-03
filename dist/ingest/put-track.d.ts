import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import { type Oplog } from '#oplog/dag.ts';
import type { IngestedTrack } from '#types/ingest.ts';
export interface TrackTarget {
    readonly oplog: Oplog;
    readonly key_pair: KeyPair;
    readonly content_store: ContentStore;
}
export declare const find_existing_track: ({ oplog, track_id }: {
    oplog: Oplog;
    track_id: string;
}) => IngestedTrack | undefined;
export declare const put_track: ({ target, content, tags, timestamp }: {
    target: TrackTarget;
    content: Record<string, unknown>;
    tags?: readonly string[] | undefined;
    timestamp?: number | undefined;
}) => Promise<IngestedTrack>;
