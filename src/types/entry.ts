// Entry, envelope, record, and operation shapes (§2.2, §2.7, §2.8, §3.4,
// §3.5.5, §3.5.10, §4.1, §4.8.2).

import type { CompressedPubkeyHex } from './identity.ts'

export type EnvelopeType = 'track' | 'log' | 'about'
export type DeletableType = 'track' | 'log'

// The read view of a record-entry envelope: known fields only. Unknown extras
// on a received envelope are ignored (§2.2).
export interface Envelope {
  readonly id: string
  readonly timestamp: number
  readonly v: 1
  readonly type: EnvelopeType
  readonly content: string
  readonly tags?: readonly string[]
}

// capability_id rides on an operation written under a capability (§2.8.1).
// A write-list signer's is ignored, so the view only carries a string one.
export interface PutOperation {
  readonly op: 'PUT'
  readonly key: string
  readonly value: Envelope
  readonly capability_id?: string
}

export interface DelOperation {
  readonly op: 'DEL'
  readonly key: string
  readonly value: { readonly type: DeletableType, readonly timestamp: number }
  readonly capability_id?: string
}

export type Operation = PutOperation | DelOperation

// Capability and revocation records ride inline in a recordstore PUT (§3.5.5,
// §3.5.10). The record is kept as received: its fields are read through the
// shape checks in src/capability, which tell malformed from unknown.
export interface AccessRecordPut {
  readonly op: 'PUT'
  readonly key: string
  readonly value: { readonly type: 'capability' | 'revocation', readonly timestamp: number } & Readonly<Record<string, unknown>>
  readonly capability_id?: string
}

// A write-list operation whose record type this version does not define:
// merged, with no state effect (§4.4.1, §4.8.2).
export interface OpaqueOperation {
  readonly op: 'PUT' | 'DEL'
  readonly key: string
  readonly value: Readonly<Record<string, unknown>>
  readonly opaque: true
}

export type IdentityRecordType = 'library' | 'link' | 'pin'

export type IdentityRecord =
  | { readonly type: 'library', readonly v: 1, readonly timestamp: number, readonly address: string }
  | { readonly type: 'link', readonly v: 1, readonly timestamp: number, readonly address: string, readonly alias?: string }
  | { readonly type: 'pin', readonly v: 1, readonly timestamp: number, readonly cid: string }

export type IdentityOperation =
  | { readonly op: 'PUT', readonly key: string, readonly value: IdentityRecord }
  | { readonly op: 'DEL', readonly key: string, readonly value: { readonly type: IdentityRecordType, readonly timestamp: number } }

// A listens-library payload is the bare listen object, with no envelope (§2.7, §6.5).
export interface ListenPayload {
  readonly trackId: string
  readonly address: string
  readonly timestamp: number
}

export type EntryPayload = Operation | AccessRecordPut | OpaqueOperation | IdentityOperation | ListenPayload

export interface LamportClock {
  readonly id: CompressedPubkeyHex
  readonly time: number
}

// The 6-field signing input (§3.4.1). No hash, key, or sig. The payload is
// typed once the oplog validates it against the library type.
export interface UnsignedEntry {
  readonly id: string
  readonly payload: unknown
  readonly next: readonly string[]
  readonly refs: readonly string[]
  readonly v: 2
  readonly clock: LamportClock
}

// The 8-field persisted and wire object (§3.4.3, §4.1.1). entry.hash is not a
// field; it lives beside the entry on HashedEntry.
export interface SignedEntry extends UnsignedEntry {
  readonly key: CompressedPubkeyHex
  readonly sig: string
}
