import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import { type Oplog } from '#oplog/dag.ts';
import type { IngestedTrack } from '#types/ingest.ts';
export interface TrackTarget {
    readonly oplog: Oplog;
    readonly key_pair: KeyPair;
    readonly content_store: ContentStore;
    readonly capability_id?: string | undefined;
}
export declare const find_existing_track: ({ oplog, track_id }: {
    oplog: Oplog;
    track_id: string;
}) => IngestedTrack | undefined;
export declare const stored_track_duration: ({ content_store, content_cid }: {
    content_store: ContentStore;
    content_cid: string;
}) => Promise<number | undefined>;
export declare const put_track: ({ target, content, tags, timestamp }: {
    target: TrackTarget;
    content: Record<string, unknown>;
    tags?: readonly string[] | undefined;
    timestamp?: number | undefined;
}) => Promise<IngestedTrack>;
export declare const add_track_resolver: ({ target, track_id, resolver }: {
    target: TrackTarget;
    track_id: string;
    resolver: {
        readonly extractor: string;
        readonly id: string;
    };
}) => Promise<IngestedTrack | undefined>;
