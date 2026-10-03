import { type ResolvedEntry, type ResolverEntry } from 'record-resolver';
import type { IngestedTrack } from '#types/ingest.ts';
import type { Download } from './download.ts';
import { type PreparedTrack, type ReleaseBlobs } from './pipeline-local.ts';
import { type TrackTarget } from './put-track.ts';
import type { Toolchain } from './toolchain.ts';
export type FindBySource = (source: {
    extractor: string;
    id: string;
}) => IngestedTrack | undefined;
export type PreparedSource = {
    readonly kind: 'cached';
    readonly track: IngestedTrack;
} | {
    readonly kind: 'downloaded';
    readonly resolver: ResolverEntry;
    readonly prepared: PreparedTrack;
};
export declare const prepare_resolved_entry: ({ entry, target, toolchain, find_by_source, download }: {
    entry: ResolvedEntry;
    target: TrackTarget;
    toolchain: Toolchain;
    find_by_source: FindBySource;
    download: Download;
}) => Promise<PreparedSource>;
export declare const commit_resolved_entry: ({ source, target, release, tags, timestamp }: {
    source: PreparedSource;
    target: TrackTarget;
    release: ReleaseBlobs;
    tags?: readonly string[] | undefined;
    timestamp?: number | undefined;
}) => Promise<IngestedTrack>;
export declare const source_blobs: (source: PreparedSource) => readonly string[];
export declare const ingest_resolved_entry: ({ entry, target, toolchain, find_by_source, download, tags, timestamp, release }: {
    entry: ResolvedEntry;
    target: TrackTarget;
    toolchain: Toolchain;
    find_by_source: FindBySource;
    download: Download;
    tags?: readonly string[];
    timestamp?: number;
    release?: ReleaseBlobs;
}) => Promise<IngestedTrack>;
