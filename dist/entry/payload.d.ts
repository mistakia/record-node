export declare const decode_payload: (bytes: Uint8Array) => unknown;
export declare const resolver_key: ({ extractor, id }: {
    extractor: string;
    id: string;
}) => string;
export declare const validate_resolver_entries: (value: unknown) => void;
export declare const validate_track_content: (value: unknown) => Record<string, unknown>;
