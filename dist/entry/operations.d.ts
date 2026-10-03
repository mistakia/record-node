import type { AccessRecordPut, DelOperation, DeletableType, Envelope, EntryPayload, IdentityOperation, Operation, PutOperation } from '#types/entry.ts';
import type { LibraryType } from '#types/library.ts';
export declare const build_put_operation: ({ envelope, capability_id }: {
    envelope: Envelope;
    capability_id?: string | undefined;
}) => PutOperation;
export declare const build_record_put_operation: ({ key, value, capability_id }: {
    key: string;
    value: Record<string, unknown>;
    capability_id?: string | undefined;
}) => AccessRecordPut;
export declare const build_del_operation: ({ key, type, timestamp }: {
    key: string;
    type: DeletableType;
    timestamp?: number;
}) => DelOperation;
export declare const validate_operation: ({ payload, library_type }: {
    payload: unknown;
    library_type: LibraryType;
}) => EntryPayload;
export declare const is_put: (payload: EntryPayload) => payload is PutOperation;
export declare const is_envelope_operation: (payload: EntryPayload) => payload is Operation;
export declare const is_access_record: (payload: EntryPayload) => payload is AccessRecordPut;
export declare const is_identity_operation: (payload: EntryPayload) => payload is IdentityOperation;
