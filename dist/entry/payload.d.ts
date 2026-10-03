export declare const decode_payload: (bytes: Uint8Array) => unknown;
export declare const resolver_key: ({ extractor, id }: {
    extractor: string;
    id: string;
}) => string;
export declare const validate_resolver_entries: (value: unknown) => void;
export declare const validate_track_content: (value: unknown) => Record<string, unknown>;
export declare const validate_log_content: (value: unknown) => Record<string, unknown>;
export declare const validate_about_content: ({ value, library_address }: {
    value: unknown;
    library_address: string;
}) => Record<string, unknown>;
