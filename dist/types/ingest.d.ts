export type IngestErrorCode = 'toolchain_unavailable' | 'toolchain_mismatch' | 'tool_failed' | 'no_audio' | 'empty_fingerprint' | 'degenerate_fingerprint' | 'track_id_collision' | 'invalid_duration' | 'non_audio_stream' | 'download_failed';
export declare class IngestError extends Error {
    readonly code: IngestErrorCode;
    constructor(code: IngestErrorCode, message: string);
}
export interface IngestedTrack {
    readonly track_id: string;
    readonly content_cid: string;
    readonly entry_hash: string;
    readonly existing: boolean;
}
export type ImportSource = 'file' | 'url';
export interface ImportAck {
    readonly import_id: string;
    readonly file_count: number;
}
export interface ImportEventPayloads {
    'import:starting': {
        readonly import_id: string;
        readonly source: ImportSource;
        readonly file_count: number;
    };
    'import:processed-file': {
        readonly import_id: string;
        readonly file_path: string;
        readonly track: IngestedTrack;
        readonly completed: number;
        readonly remaining: number;
    };
    'import:error': {
        readonly import_id: string;
        readonly file_path: string;
        readonly error: {
            readonly code: string;
            readonly message: string;
        };
        readonly completed: number;
        readonly remaining: number;
    };
    'import:finished': {
        readonly import_id: string;
        readonly track_count: number;
        readonly error_count: number;
    };
}
export type ImportEventType = keyof ImportEventPayloads;
export type ImportEventHandler<T extends ImportEventType> = (payload: ImportEventPayloads[T]) => void;
export interface ImportEvents {
    on: <T extends ImportEventType>(type: T, handler: ImportEventHandler<T>) => () => void;
}
export interface Importer extends ImportEvents {
    import_files: (input: {
        file_paths: readonly string[];
        source?: ImportSource;
    }) => ImportAck;
}
