export type ProtocolErrorCode = 'malformed_encoding' | 'non_canonical_encoding' | 'size_exceeded' | 'invalid_shape' | 'invalid_cid' | 'cid_mismatch' | 'content_unavailable' | 'invalid_public_key' | 'invalid_private_key' | 'test_key_refused' | 'invalid_fingerprint' | 'invalid_library_name' | 'invalid_library_address' | 'library_rejected' | 'library_unopenable' | 'unsupported_ac_type' | 'invalid_operation' | 'invalid_signature' | 'unauthorised_writer' | 'duplicate_entry';
export declare class ProtocolError extends Error {
    readonly code: ProtocolErrorCode;
    constructor(code: ProtocolErrorCode, message: string);
}
