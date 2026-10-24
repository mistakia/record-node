import { type LabelDiff, type LabelledTrack, type TrackTarget } from './put-track.ts';
export declare const ingest_cid: ({ content_cid, target, timestamp, labels }: {
    content_cid: string;
    target: TrackTarget;
    timestamp?: number;
    labels?: ((track_id: string) => LabelDiff) | undefined;
}) => Promise<LabelledTrack>;
