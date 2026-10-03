import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import { type MetaLogPage, type MetaLogRecord } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const try_open_library: (context: PeerContext, address: string) => Promise<void>;
export declare const connect_address: (context: PeerContext, address: string) => Promise<void>;
export declare const append_identity_record: (context: PeerContext, payload: unknown) => Promise<void>;
export declare const finish_pending_unlinks: (context: PeerContext) => Promise<void>;
export declare const link_address: (context: PeerContext, { address, alias }: {
    address: string;
    alias: string | null;
}) => Promise<void>;
export declare const unlink_library: (context: PeerContext, address: string) => Promise<void>;
export declare const create_own_library: (context: PeerContext, { discriminator }: {
    discriminator?: string | undefined;
}) => Promise<string>;
export declare const retire_own_library: (context: PeerContext, address: string) => Promise<void>;
export declare const ensure_listens_library: (context: PeerContext) => Promise<string>;
export declare const sync_identity: (context: PeerContext) => Promise<void>;
export declare const queue_identity_sync: (context: PeerContext) => void;
export declare const open_identity: (context: PeerContext, key_pair: KeyPair) => Promise<void>;
export declare const meta_log_record: (context: PeerContext, entry: VerifiedEntry) => MetaLogRecord;
export declare const read_meta_log: (context: PeerContext, { offset, limit, type, current_only }: {
    offset: number;
    limit: number;
    type?: string | undefined;
    current_only: boolean;
}) => MetaLogPage;
