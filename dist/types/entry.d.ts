import type { CompressedPubkeyHex } from './identity.ts';
export interface Envelope {
    readonly id: string;
    readonly timestamp: number;
    readonly v: 1;
    readonly type: 'track';
    readonly content: string;
}
export type LabelPair = readonly [track_id: string, label: string];
export interface LabelsRecord {
    readonly type: 'labels';
    readonly v: 1;
    readonly timestamp: number;
    readonly set: readonly LabelPair[];
    readonly unset: readonly LabelPair[];
}
export interface AboutRecord {
    readonly type: 'about';
    readonly v: 1;
    readonly timestamp: number;
    readonly name: string;
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
        readonly type: 'track';
        readonly timestamp: number;
    };
    readonly capability_id?: string;
}
export type Operation = PutOperation | DelOperation;
export interface LabelsPut {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: LabelsRecord;
    readonly capability_id?: string;
}
export interface AboutPut {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: AboutRecord;
    readonly capability_id?: string;
}
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
export type IdentityRecordType = 'library' | 'link' | 'pin' | 'profile';
export interface ProfileRecord {
    readonly type: 'profile';
    readonly v: 1;
    readonly timestamp: number;
    readonly name?: string;
    readonly bio?: string;
    readonly avatar?: string;
}
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
} | ProfileRecord;
export type IdentityOperation = {
    readonly op: 'PUT';
    readonly key: string;
    readonly value: IdentityRecord;
} | {
    readonly op: 'DEL';
    readonly key: string;
    readonly value: {
        readonly type: Exclude<IdentityRecordType, 'profile'>;
        readonly timestamp: number;
    };
};
export interface ListenPayload {
    readonly trackId: string;
    readonly address: string;
    readonly timestamp: number;
}
export type EntryPayload = Operation | LabelsPut | AboutPut | AccessRecordPut | OpaqueOperation | IdentityOperation | ListenPayload;
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
