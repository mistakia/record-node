import type { DelOperation, DeletableType, Envelope, EntryPayload, PutOperation } from '#types/entry.ts';
import type { LibraryType } from '#types/library.ts';
export declare const build_put_operation: ({ envelope }: {
    envelope: Envelope;
}) => PutOperation;
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
export declare const is_operation: (payload: EntryPayload) => payload is PutOperation | DelOperation;
