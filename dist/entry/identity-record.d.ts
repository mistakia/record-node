import type { IdentityOperation, IdentityRecord, IdentityRecordType, OpaqueOperation } from '#types/entry.ts';
export declare const IDENTITY_RECORD_TYPES: readonly IdentityRecordType[];
export declare const is_identity_record_type: (value: unknown) => value is IdentityRecordType;
export declare const canonical_cid: (cid: string) => string;
export declare const identity_record_key: (record: IdentityRecord) => string;
export declare const validate_identity_operation: (payload: unknown) => IdentityOperation | OpaqueOperation;
export declare const build_identity_put: (record: IdentityRecord) => IdentityOperation;
export declare const build_identity_del: ({ type, key, timestamp }: {
    type: IdentityRecordType;
    key: string;
    timestamp?: number;
}) => IdentityOperation;
