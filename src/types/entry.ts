// Entry, envelope, and operation shapes (§2.2, §2.7, §2.8, §3.4, §4.1).

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

export interface PutOperation {
  readonly op: 'PUT'
  readonly key: string
  readonly value: Envelope
}

export interface DelOperation {
  readonly op: 'DEL'
  readonly key: string
  readonly value: { readonly type: DeletableType, readonly timestamp: number }
}

export type Operation = PutOperation | DelOperation

// A listens-library payload is the bare listen object, with no envelope (§2.7, §6.5).
export interface ListenPayload {
  readonly trackId: string
  readonly address: string
  readonly timestamp: number
}

export type EntryPayload = Operation | ListenPayload

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
