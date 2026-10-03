import type { Importer, IngestedTrack } from '#types/ingest.ts';
export declare const create_importer: ({ ingest_file }: {
    ingest_file: (file_path: string, index: number) => Promise<IngestedTrack>;
}) => Importer;
