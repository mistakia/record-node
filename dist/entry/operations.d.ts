import type { AboutPut, AccessRecordPut, DelOperation, Envelope, EntryPayload, IdentityOperation, LabelPair, LabelsPut, Operation, PutOperation } from '#types/entry.ts';
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
export declare const build_labels_put: ({ set, unset, timestamp, capability_id }: {
    set?: readonly LabelPair[];
    unset?: readonly LabelPair[];
    timestamp?: number;
    capability_id?: string | undefined;
}) => LabelsPut;
export declare const build_about_put: ({ name, timestamp, capability_id }: {
    name: string;
    timestamp?: number;
    capability_id?: string | undefined;
}) => AboutPut;
export declare const build_del_operation: ({ key, timestamp }: {
    key: string;
    timestamp?: number;
}) => DelOperation;
export declare const validate_operation: ({ payload, library_type, write_list_signer }: {
    payload: unknown;
    library_type: LibraryType;
    write_list_signer?: boolean;
}) => EntryPayload;
export declare const is_put: (payload: EntryPayload) => payload is PutOperation;
export declare const is_labels_put: (payload: EntryPayload) => payload is LabelsPut;
export declare const is_about_put: (payload: EntryPayload) => payload is AboutPut;
export declare const is_envelope_operation: (payload: EntryPayload) => payload is Operation;
export declare const is_access_record: (payload: EntryPayload) => payload is AccessRecordPut;
export declare const is_identity_operation: (payload: EntryPayload) => payload is IdentityOperation;
