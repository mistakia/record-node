export declare const SIGNED_ENTRY_MAX_BYTES: number;
export declare const PAYLOAD_MAX_BYTES: number;
export declare const ENVELOPE_TAGS_MAX_COUNT = 256;
export declare const ENVELOPE_TAG_MAX_BYTES = 128;
export declare const ENVELOPE_TAGS_MAX_SERIALISED_BYTES: number;
export declare const assert_signed_entry_size: (bytes: Uint8Array) => void;
export declare const assert_payload_size: (bytes: Uint8Array) => void;
export declare const assert_envelope_tags: (tags: unknown) => readonly string[];
