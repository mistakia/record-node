import type { CompressedPubkeyHex } from './identity.ts';
export type EnvelopeType = 'track' | 'log' | 'about';
export type DeletableType = 'track' | 'log';
export interface Envelope {
    readonly id: string;
    readonly timestamp: number;
    readonly v: 1;
    readonly type: EnvelopeType;
    readonly content: string;
    readonly tags?: readonly string[];
}
export interface PutOperation {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: Envelope;
    readonly capability_id?: string;
}
export interface DelOperation {
    readonly op: 'DEL';
    readonly key: string;
    readonly value: {
        readonly type: DeletableType;
        readonly timestamp: number;
    };
    readonly capability_id?: string;
}
export type Operation = PutOperation | DelOperation;
export interface AccessRecordPut {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: {
        readonly type: 'capability' | 'revocation';
        readonly timestamp: number;
    } & Readonly<Record<string, unknown>>;
    readonly capability_id?: string;
}
export interface OpaqueOperation {
    readonly op: 'PUT' | 'DEL';
    readonly key: string;
    readonly value: Readonly<Record<string, unknown>>;
    readonly opaque: true;
}
export type IdentityRecordType = 'library' | 'link' | 'pin';
export type IdentityRecord = {
    readonly type: 'library';
    readonly v: 1;
    readonly timestamp: number;
    readonly address: string;
} | {
    readonly type: 'link';
    readonly v: 1;
    readonly timestamp: number;
    readonly address: string;
    readonly alias?: string;
} | {
    readonly type: 'pin';
    readonly v: 1;
    readonly timestamp: number;
    readonly cid: string;
};
export type IdentityOperation = {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: IdentityRecord;
} | {
    readonly op: 'DEL';
    readonly key: string;
    readonly value: {
        readonly type: IdentityRecordType;
        readonly timestamp: number;
    };
};
export interface ListenPayload {
    readonly trackId: string;
    readonly address: string;
    readonly timestamp: number;
}
export type EntryPayload = Operation | AccessRecordPut | OpaqueOperation | IdentityOperation | ListenPayload;
export interface LamportClock {
    readonly id: CompressedPubkeyHex;
    readonly time: number;
}
export interface UnsignedEntry {
    readonly id: string;
    readonly payload: unknown;
    readonly next: readonly string[];
    readonly refs: readonly string[];
    readonly v: 2;
    readonly clock: LamportClock;
}
export interface SignedEntry extends UnsignedEntry {
    readonly key: CompressedPubkeyHex;
    readonly sig: string;
}
