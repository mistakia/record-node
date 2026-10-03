import { type ResolvedEntry } from 'record-resolver';
import type { IngestedTrack } from '#types/ingest.ts';
import type { Download } from './download.ts';
import { type TrackTarget } from './put-track.ts';
import type { Toolchain } from './toolchain.ts';
export type FindBySource = (source: {
    extractor: string;
    id: string;
}) => IngestedTrack | undefined;
export declare const ingest_resolved_entry: ({ entry, target, toolchain, find_by_source, download, tags, timestamp }: {
    entry: ResolvedEntry;
    target: TrackTarget;
    toolchain: Toolchain;
    find_by_source: FindBySource;
    download: Download;
    tags?: readonly string[];
    timestamp?: number;
}) => Promise<IngestedTrack>;
