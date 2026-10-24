export declare const SIGNED_ENTRY_MAX_BYTES: number;
export declare const PAYLOAD_MAX_BYTES: number;
export declare const LABEL_MAX_BYTES = 128;
export declare const assert_signed_entry_size: (bytes: Uint8Array) => void;
export declare const assert_payload_size: (bytes: Uint8Array) => void;
export declare const assert_label: (label: unknown) => string;
