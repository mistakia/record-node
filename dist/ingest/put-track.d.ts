import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import { type Oplog } from '#oplog/dag.ts';
import type { LabelPair } from '#types/entry.ts';
import type { IngestedTrack } from '#types/ingest.ts';
export interface TrackTarget {
    readonly oplog: Oplog;
    readonly key_pair: KeyPair;
    readonly content_store: ContentStore;
    readonly capability_id?: string | undefined;
}
export interface LabelDiff {
    readonly set: readonly LabelPair[];
    readonly unset: readonly LabelPair[];
}
export declare const is_empty_diff: ({ set, unset }: LabelDiff) => boolean;
export type LabelledTrack = IngestedTrack & {
    readonly label_entry_hash?: string | undefined;
};
export declare const labels_payload: (target: TrackTarget, diff: LabelDiff) => unknown;
export declare const check_payload: (target: TrackTarget, payload: unknown) => void;
export declare const put_labels: ({ target, payload }: {
    target: TrackTarget;
    payload: unknown;
}) => Promise<string>;
export declare const find_existing_track: ({ oplog, track_id }: {
    oplog: Oplog;
    track_id: string;
}) => IngestedTrack | undefined;
export declare const stored_track_duration: ({ content_store, content_cid }: {
    content_store: ContentStore;
    content_cid: string;
}) => Promise<number | undefined>;
export declare const put_track: ({ target, content, timestamp }: {
    target: TrackTarget;
    content: Record<string, unknown>;
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
