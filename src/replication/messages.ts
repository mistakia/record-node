// Network message bodies (§5.3.2, §5.4.1) as JSON codecs with the 256 KiB
// bound: encoders never produce a larger message, and decoders drop one
// before parsing it. Publishing and coalescing belong to the replication engine.

import { parse_library_address } from '#encoding/library-address.ts'
import { is_cid_string } from '#encoding/cid.ts'
import { is_record } from '#types/guards.ts'
import type { SignedEntry } from '#types/entry.ts'

// §5.3.2 and §5.4.1: after JSON encoding.
export const NETWORK_MESSAGE_MAX_BYTES = 256 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const byte_length = (json: string) => encoder.encode(json).length

// Oversized or unparseable bytes are dropped without processing.
const parse_bounded = (data: Uint8Array): unknown => {
  if (data.length > NETWORK_MESSAGE_MAX_BYTES) return undefined
  try {
    return JSON.parse(decoder.decode(data))
  } catch {
    return undefined
  }
}

export const encode_heads_message = ({ heads, incomplete = false }: { heads: readonly string[], incomplete?: boolean }): string =>
  JSON.stringify(incomplete ? { type: 'heads', heads, incomplete: true } : { type: 'heads', heads })

// One trigger's heads as messages within the bound (§5.4.1): every message but
// the last carries incomplete: true. An empty set is one empty message.
export const encode_heads_batches = ({ heads, max_bytes = NETWORK_MESSAGE_MAX_BYTES }: {
  heads: readonly string[]
  max_bytes?: number
}): Uint8Array[] => {
  const overhead = byte_length(encode_heads_message({ heads: [], incomplete: true }))
  const batches: string[][] = [[]]
  let size = overhead
  for (const head of heads) {
    const batch = batches[batches.length - 1] as string[]
    const added = byte_length(JSON.stringify(head)) + (batch.length > 0 ? 1 : 0)
    if (batch.length > 0 && size + added > max_bytes) {
      batches.push([head])
      size = overhead + added - 1
    } else {
      batch.push(head)
      size += added
    }
  }
  return batches.map((batch, index) => encoder.encode(encode_heads_message({ heads: batch, incomplete: index < batches.length - 1 })))
}

export interface HeadsMessage {
  readonly heads: readonly string[]
  readonly incomplete: boolean
}

// A heads message whose every element is a CID string, or undefined.
export const decode_heads_message = (data: Uint8Array): HeadsMessage | undefined => {
  const value = parse_bounded(data)
  if (!is_record(value) || value.type !== 'heads' || !Array.isArray(value.heads)) return undefined
  if (!value.heads.every(is_cid_string)) return undefined
  return { heads: value.heads as string[], incomplete: value.incomplete === true }
}

// A LoadedAboutEntry is the signed about entry with entry.hash alongside and
// the about payload inlined in place of the envelope content CID. It is a hint
// only; receivers re-fetch the canonical entry by hash to authenticate it.
export const build_loaded_about_entry = ({ hash, entry, about_content }: {
  hash: string
  entry: SignedEntry
  about_content: Record<string, unknown>
}) => {
  const { op, key, value } = entry.payload as {
    op: string
    key: string
    value: { id: string, timestamp: number, v: number, type: string }
  }
  return {
    hash,
    id: entry.id,
    payload: {
      op,
      key,
      value: { id: value.id, timestamp: value.timestamp, v: value.v, type: value.type, content: about_content }
    },
    next: entry.next,
    refs: entry.refs,
    v: entry.v,
    clock: entry.clock,
    key: entry.key,
    sig: entry.sig
  }
}

export type LoadedAboutEntry = ReturnType<typeof build_loaded_about_entry>

// The announcement within the bound (§5.3.2): linked logs that would push it
// over are left out, and an about entry too large alone is not sent at all.
export const encode_announcement = ({ about, logs }: { about: LoadedAboutEntry, logs: readonly LoadedAboutEntry[] }): Uint8Array | undefined => {
  const kept = [...logs]
  for (;;) {
    const bytes = encoder.encode(JSON.stringify({ about, logs: kept }))
    if (bytes.length <= NETWORK_MESSAGE_MAX_BYTES) return bytes
    if (kept.length === 0) return undefined
    kept.pop()
  }
}

// An announced library: its address, and the untrusted about hint.
export interface AnnouncedLibrary {
  readonly address: string
  readonly hint: LoadedAboutEntry
}

const announced_library = (value: unknown): AnnouncedLibrary | undefined => {
  if (!is_record(value) || typeof value.hash !== 'string' || !is_record(value.payload)) return undefined
  const content = is_record(value.payload.value) ? value.payload.value.content : undefined
  if (!is_record(content) || typeof content.address !== 'string') return undefined
  try {
    parse_library_address(content.address)
  } catch {
    return undefined
  }
  return { address: content.address, hint: value as unknown as LoadedAboutEntry }
}

// §5.3.4 steps 1, 2 and 4: parse, and keep the about and each log whose
// content.address is a valid library address. Undefined drops the message.
export const decode_announcement = (data: Uint8Array): { about: AnnouncedLibrary, logs: AnnouncedLibrary[] } | undefined => {
  const value = parse_bounded(data)
  if (!is_record(value)) return undefined
  const about = announced_library(value.about)
  if (about === undefined) return undefined
  const logs = Array.isArray(value.logs) ? value.logs.flatMap((log) => announced_library(log) ?? []) : []
  return { about, logs }
}
