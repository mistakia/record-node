// Current-state resolution (§4.4.2): sort by (clock.time DESC,
// envelope.timestamp DESC, entry.hash ASC) and take the first. The hash
// tiebreak compares raw multihash bytes, never the base58btc string.

import type { HashedEntry } from '#entry/signed.ts'
import { is_record } from '#types/guards.ts'

export const compare_bytes = (a: Uint8Array, b: Uint8Array): number => {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

// PUT carries the envelope or record timestamp and DEL its own, all at value.timestamp.
export const envelope_timestamp = ({ entry }: HashedEntry): number => {
  const { payload } = entry
  const value = is_record(payload) ? payload.value : undefined
  return is_record(value) && typeof value.timestamp === 'number' ? value.timestamp : 0
}

export const compare_current_state = (a: HashedEntry, b: HashedEntry): number =>
  b.entry.clock.time - a.entry.clock.time ||
  envelope_timestamp(b) - envelope_timestamp(a) ||
  compare_bytes(a.multihash, b.multihash)

export const resolve_current_state = <T extends HashedEntry>(entries: Iterable<T>): T | undefined => {
  let current: T | undefined
  for (const entry of entries) {
    if (current === undefined || compare_current_state(entry, current) < 0) current = entry
  }
  return current
}
