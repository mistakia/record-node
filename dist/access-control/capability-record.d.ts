import { type Shape } from './filter.ts';
export declare const ACCESS_RECORD_TYPES: readonly ["capability", "revocation"];
export type AccessRecordType = typeof ACCESS_RECORD_TYPES[number];
export declare const ACTIONS: readonly ["library.append_track", "library.append_tag", "library.update_about", "library.grant_capability"];
export type Action = typeof ACTIONS[number];
export declare const is_access_record_type: (value: unknown) => value is AccessRecordType;
export declare const record_key: (value: unknown) => string;
export declare const grantee_shape: (grantee: unknown) => Shape;
export declare const condition_shape: (condition: unknown) => Shape;
export declare const capability_shape: (record: Record<string, unknown>) => Shape;
export declare const validate_access_record: ({ key, value }: {
    key: string;
    value: Record<string, unknown>;
}) => void;
export declare const grantee_matches: (grantee: unknown, key: string) => boolean;
export declare const conditions_hold: (conditions: unknown, timestamp: number) => boolean;
export declare const capability_fails_closed: (record: Record<string, unknown>) => boolean;
export declare const assert_issuable_capability: (record: Record<string, unknown>) => void;
export declare const build_capability_record: ({ timestamp, grantee, actions, filter, conditions }: {
    timestamp?: number;
    grantee: unknown;
    actions: readonly string[];
    filter?: unknown;
    conditions?: readonly unknown[] | undefined;
}) => Record<string, unknown>;
export declare const build_revocation_record: ({ timestamp, revokes }: {
    timestamp?: number;
    revokes: string;
}) => Record<string, unknown>;
