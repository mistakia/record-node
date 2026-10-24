import { type IngestedTrack } from '#types/ingest.ts';
import { type TrackTarget } from './put-track.ts';
import type { Toolchain } from './toolchain.ts';
export declare const COLLISION_TOLERANCE_SECONDS = 30;
export type PreparedTrack = {
    readonly kind: 'existing';
    readonly track: IngestedTrack;
} | {
    readonly kind: 'new';
    readonly file_path: string;
    readonly track_id: string;
    readonly duration: number;
    readonly content: Record<string, unknown>;
    readonly blobs: readonly string[];
};
export type ReleaseBlobs = (cids: readonly string[]) => Promise<void>;
export declare const prepare_local_file: ({ file_path, target, toolchain, resolver }: {
    file_path: string;
    target: TrackTarget;
    toolchain: Toolchain;
    resolver?: readonly Record<string, unknown>[];
}) => Promise<PreparedTrack>;
export declare const commit_local_file: ({ prepared, target, release, timestamp }: {
    prepared: PreparedTrack;
    target: TrackTarget;
    release: ReleaseBlobs;
    timestamp?: number | undefined;
}) => Promise<IngestedTrack>;
export declare const prepared_blobs: (prepared: PreparedTrack) => readonly string[];
export declare const ingest_local_file: ({ file_path, target, toolchain, resolver, timestamp, release }: {
    file_path: string;
    target: TrackTarget;
    toolchain: Toolchain;
    resolver?: readonly Record<string, unknown>[];
    timestamp?: number;
    release?: ReleaseBlobs;
}) => Promise<IngestedTrack>;
