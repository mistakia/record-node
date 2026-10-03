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
}
export interface DelOperation {
    readonly op: 'DEL';
    readonly key: string;
    readonly value: {
        readonly type: DeletableType;
        readonly timestamp: number;
    };
}
export type Operation = PutOperation | DelOperation;
export interface ListenPayload {
    readonly trackId: string;
    readonly address: string;
    readonly timestamp: number;
}
export type EntryPayload = Operation | ListenPayload;
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
