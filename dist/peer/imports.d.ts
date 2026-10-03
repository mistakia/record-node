import { type PreparedTrack, type ReleaseBlobs } from '#ingest/pipeline-local.ts';
import { type TrackTarget } from '#ingest/put-track.ts';
import { type IngestedTrack } from '#types/ingest.ts';
import { type ImportAck, type WriteTargetInput } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const local_file_phases: (context: PeerContext, file_path: string) => {
    prepare: (target: TrackTarget) => Promise<PreparedTrack>;
    commit: ({ target, prepared, release }: {
        target: TrackTarget;
        prepared: PreparedTrack;
        release: ReleaseBlobs;
    }) => Promise<IngestedTrack>;
    blobs: (prepared: PreparedTrack) => readonly string[];
};
export declare const import_files: (context: PeerContext, { paths, library_address, capability_id }: {
    paths: string[];
} & WriteTargetInput) => ImportAck;
export declare const import_url: (context: PeerContext, { url, library_address, capability_id }: {
    url: string;
} & WriteTargetInput) => Promise<ImportAck>;
