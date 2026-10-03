// The append-only entry DAG of one library (§4.1, §4.3, §4.4) and local append.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { build_unsigned_entry } from '#entry/build.ts'
import { is_operation, is_put, validate_operation } from '#entry/operations.ts'
import { hash_signed_entry } from '#entry/signed.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { sign_entry } from '#identity/signing.ts'
import { ProtocolError } from '#types/errors.ts'
import { verify_entry, type VerifiedEntry } from './accept.ts'
import { next_clock_time } from './clock.ts'
import { resolve_current_state } from './current-state.ts'
import { duplicate_key } from './duplicate-key.ts'

export interface Oplog {
  readonly chain: ResolvedAcChain
  readonly entries: Map<string, VerifiedEntry>
  readonly heads: Set<string>
  readonly referenced: Set<string>
  readonly key_entries: Map<string, Set<string>>
  readonly current: Map<string, VerifiedEntry>
  clock_time: number
}

// An oplog exists only over a verified AC chain (§3.5.1).
export const create_oplog = ({ chain }: { chain: ResolvedAcChain }): Oplog => ({
  chain,
  entries: new Map(),
  heads: new Set(),
  referenced: new Set(),
  key_entries: new Map(),
  current: new Map(),
  clock_time: 0
})

// Idempotent: an entry whose hash is already present is a no-op (§4.5 step 2).
// Heads stay equal to heads(all entries) whatever order entries arrive in.
export const insert_entry = ({ oplog, entry }: { oplog: Oplog, entry: VerifiedEntry }): boolean => {
  if (oplog.entries.has(entry.hash)) return false
  oplog.entries.set(entry.hash, entry)
  for (const parent of entry.entry.next) {
    oplog.referenced.add(parent)
    oplog.heads.delete(parent)
  }
  if (!oplog.referenced.has(entry.hash)) oplog.heads.add(entry.hash)
  if (is_operation(entry.operation)) {
    const hashes = oplog.key_entries.get(entry.operation.key) ?? new Set()
    oplog.key_entries.set(entry.operation.key, hashes.add(entry.hash))
  }
  return true
}

// Re-resolves each key over every known entry for it, never only the new ones (§4.4.2).
export const refresh_current_state = ({ oplog, keys }: { oplog: Oplog, keys: Iterable<string> }): void => {
  for (const key of keys) {
    const hashes = oplog.key_entries.get(key) ?? new Set<string>()
    const current = resolve_current_state([...hashes].map((hash) => oplog.entries.get(hash) as VerifiedEntry))
    if (current === undefined) oplog.current.delete(key)
    else oplog.current.set(key, current)
  }
}

// The current entry for a key if it is a PUT; a current DEL tombstones the key.
export const get_live_entry = ({ oplog, key }: { oplog: Oplog, key: string }): VerifiedEntry | undefined => {
  const current = oplog.current.get(key)
  return current !== undefined && is_put(current.operation) ? current : undefined
}

const assert_not_duplicate = ({ oplog, payload }: { oplog: Oplog, payload: unknown }) => {
  const operation = validate_operation({ payload, library_type: oplog.chain.type })
  if (!is_put(operation)) return
  const live = get_live_entry({ oplog, key: operation.key })
  if (live === undefined || !is_put(live.operation)) return
  const library_address = oplog.chain.address
  if (duplicate_key({ library_address, envelope: live.operation.value }) ===
    duplicate_key({ library_address, envelope: operation.value })) {
    throw new ProtocolError('duplicate_entry', `PUT ${operation.key} duplicates live entry ${live.hash}`)
  }
}

// Signs and appends a local operation: next is the current heads, the clock
// follows the append rule, and the entry passes the same verification as a
// remote one. A duplicate PUT (§2.10) is rejected before anything is appended.
export const append_entry = ({ oplog, payload, key_pair }: {
  oplog: Oplog
  payload: unknown
  key_pair: KeyPair
}): VerifiedEntry => {
  assert_not_duplicate({ oplog, payload })
  const heads = [...oplog.heads].sort()
  const time = next_clock_time({
    local_time: oplog.clock_time,
    head_times: heads.map((hash) => oplog.entries.get(hash)?.entry.clock.time ?? 0)
  })
  const unsigned_entry = build_unsigned_entry({
    id: oplog.chain.address,
    payload,
    next: heads,
    refs: [],
    clock: { id: key_pair.public_key, time }
  })
  const hashed = hash_signed_entry(sign_entry({ unsigned_entry, private_key: key_pair.private_key }))
  const entry = verify_entry({ hashed, chain: oplog.chain })
  insert_entry({ oplog, entry })
  oplog.clock_time = time
  if (is_operation(entry.operation)) refresh_current_state({ oplog, keys: [entry.operation.key] })
  return entry
}
