import { type IngestedTrack } from '#types/ingest.ts';
import { type TrackTarget } from './put-track.ts';
import type { Toolchain } from './toolchain.ts';
export declare const ingest_local_file: ({ file_path, target, toolchain, resolver, tags, timestamp }: {
    file_path: string;
    target: TrackTarget;
    toolchain: Toolchain;
    resolver?: readonly Record<string, unknown>[];
    tags?: readonly string[];
    timestamp?: number;
}) => Promise<IngestedTrack>;
