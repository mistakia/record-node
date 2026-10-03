export interface ExtractedPicture {
    readonly format: string;
    readonly data: Uint8Array;
}
export interface ExtractedMetadata {
    readonly tags: Record<string, unknown>;
    readonly audio: Record<string, unknown>;
    readonly pictures: readonly ExtractedPicture[];
}
export declare const extract_metadata: ({ file_path, fingerprint }: {
    file_path: string;
    fingerprint: string;
}) => Promise<ExtractedMetadata>;
