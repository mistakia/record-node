import type { LamportClock, UnsignedEntry } from '#types/entry.ts';
export declare const MAX_ENTRY_POINTERS = 256;
export declare const assert_unsigned_fields: (value: Record<string, unknown>) => UnsignedEntry;
export declare const build_unsigned_entry: (input: {
    id: string;
    payload: unknown;
    next: readonly string[];
    refs: readonly string[];
    clock: LamportClock;
}) => UnsignedEntry;
