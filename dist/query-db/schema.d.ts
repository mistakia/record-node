import { DatabaseSync } from 'node:sqlite';
export declare const QUERY_TABLES: readonly ["entries", "tracks", "tags", "resolvers", "logs", "about", "listens", "library_heads", "meta"];
export declare const SCHEMA_VERSION = 1;
export type QueryTable = typeof QUERY_TABLES[number];
export declare const apply_schema: (db: DatabaseSync) => void;
export declare const drop_schema: (db: DatabaseSync) => void;
export declare const open_query_db: ({ path }?: {
    path?: string;
}) => DatabaseSync;
export declare const in_transaction: <T>(db: DatabaseSync, fn: () => T) => T;
