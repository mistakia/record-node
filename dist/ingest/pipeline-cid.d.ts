import type { IngestedTrack } from '#types/ingest.ts';
import { type TrackTarget } from './put-track.ts';
export declare const ingest_cid: ({ content_cid, target, tags, timestamp }: {
    content_cid: string;
    target: TrackTarget;
    tags?: readonly string[];
    timestamp?: number;
}) => Promise<IngestedTrack>;
