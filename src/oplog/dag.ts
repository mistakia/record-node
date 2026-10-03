// The append-only entry DAG of one library (§4.1, §4.3, §4.4), its access
// state (§3.5.9, §3.5.10), and local append.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { effective_revocations, inert_under, is_write_list_key } from '#access-control/capability.ts'
import { build_unsigned_entry } from '#entry/build.ts'
import { is_access_record, is_put, validate_operation } from '#entry/operations.ts'
import { hash_signed_entry } from '#entry/signed.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { sign_entry } from '#identity/signing.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import { verify_entry, type VerifiedEntry } from './accept.ts'
import { in_causal_past } from './causal.ts'
import { resolve_current_state } from './current-state.ts'
import { duplicate_key } from './duplicate-key.ts'

// §4.2 and §5.4.2 item 2: an append cites at most this many heads.
export const MAX_CITED_HEADS = 256

export interface Oplog {
  readonly chain: ResolvedAcChain
  readonly entries: Map<string, VerifiedEntry>
  readonly heads: Set<string>
  readonly referenced: Set<string>
  // Entries per state key, and the current one of each (§4.4.2).
  readonly key_entries: Map<string, Set<string>>
  readonly current: Map<string, VerifiedEntry>
  // Capability and revocation records by entry hash (§4.4.1).
  readonly capabilities: Map<string, VerifiedEntry>
  readonly revocations: Map<string, VerifiedEntry>
  // Entries signed outside the write list: the only ones that can be inert.
  readonly delegated: Set<string>
  // The effective revocations, and the entries they make inert (§3.5.10).
  readonly effective: Set<string>
  readonly inert: Set<string>
}

// An oplog exists only over a verified AC chain (§3.5.1).
export const create_oplog = ({ chain }: { chain: ResolvedAcChain }): Oplog => ({
  chain,
  entries: new Map(),
  heads: new Set(),
  referenced: new Set(),
  key_entries: new Map(),
  current: new Map(),
  capabilities: new Map(),
  revocations: new Map(),
  delegated: new Set(),
  effective: new Set(),
  inert: new Set()
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
  if (entry.state_key !== undefined) {
    const hashes = oplog.key_entries.get(entry.state_key) ?? new Set()
    oplog.key_entries.set(entry.state_key, hashes.add(entry.hash))
  }
  if (is_access_record(entry.operation)) {
    const index = entry.operation.value.type === 'capability' ? oplog.capabilities : oplog.revocations
    index.set(entry.hash, entry)
  }
  if (!is_write_list_key(oplog, entry.entry.key)) oplog.delegated.add(entry.hash)
  return true
}

// Re-resolves each key over every known entry for it, never only the new ones,
// and never an inert one (§4.4.2).
export const refresh_current_state = ({ oplog, keys }: { oplog: Oplog, keys: Iterable<string> }): void => {
  for (const key of keys) {
    const hashes = [...oplog.key_entries.get(key) ?? []].filter((hash) => !oplog.inert.has(hash))
    const current = resolve_current_state(hashes.map((hash) => oplog.entries.get(hash) as VerifiedEntry))
    if (current === undefined) oplog.current.delete(key)
    else oplog.current.set(key, current)
  }
}

export interface AccessChange {
  // Entries that became inert, and the state keys whose resolution they touch.
  readonly inert: readonly VerifiedEntry[]
  readonly keys: ReadonlySet<string>
}

// Brings the effective set and the inert set up to date after inserting
// `added`. A new revocation can change the effective set in either direction,
// so every delegated entry is judged again; otherwise only the new ones are.
export const refresh_access_state = ({ oplog, added }: { oplog: Oplog, added: readonly VerifiedEntry[] }): AccessChange => {
  const revocation_added = added.some(({ hash }) => oplog.revocations.has(hash))
  if (revocation_added) {
    const effective = effective_revocations(oplog, oplog.revocations.values())
    oplog.effective.clear()
    for (const { hash } of effective) oplog.effective.add(hash)
  }
  if (!revocation_added && oplog.effective.size === 0 && oplog.inert.size === 0) return { inert: [], keys: new Set() }
  const effective = [...oplog.effective].map((hash) => oplog.entries.get(hash) as VerifiedEntry)
  const judged = revocation_added ? [...oplog.delegated] : added.filter(({ hash }) => oplog.delegated.has(hash)).map(({ hash }) => hash)
  const inert: VerifiedEntry[] = []
  const keys = new Set<string>()
  for (const hash of judged) {
    const entry = oplog.entries.get(hash) as VerifiedEntry
    // A revocation's own effect is decided only by the effective set.
    const is_inert = oplog.revocations.has(hash) ? !oplog.effective.has(hash) : inert_under(oplog, entry, effective)
    if (is_inert === oplog.inert.has(hash)) continue
    if (is_inert) {
      oplog.inert.add(hash)
      inert.push(entry)
    } else {
      oplog.inert.delete(hash)
    }
    if (entry.state_key !== undefined) keys.add(entry.state_key)
  }
  return { inert, keys }
}

// The current entry for a key if it is a PUT; a current DEL tombstones the key.
export const get_live_entry = ({ oplog, key }: { oplog: Oplog, key: string }): VerifiedEntry | undefined => {
  const current = oplog.current.get(key)
  return current !== undefined && 'op' in current.operation && current.operation.op === 'PUT' ? current : undefined
}

const assert_not_duplicate = ({ oplog, payload }: { oplog: Oplog, payload: unknown }) => {
  if (oplog.chain.type !== 'recordstore') return
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

const clock_of = (oplog: Oplog, hash: string): number => oplog.entries.get(hash)?.entry.clock.time ?? 0

// §4.2: every head when there are at most 256, otherwise the 256 with the
// greatest clock.time. A write under a capability must also keep that
// capability in its causal past (§3.5.9 step 2).
const select_next = (oplog: Oplog, capability_id: string | undefined): string[] => {
  const heads = [...oplog.heads].sort((a, b) => clock_of(oplog, b) - clock_of(oplog, a) || (a < b ? -1 : 1))
  const next = heads.slice(0, MAX_CITED_HEADS)
  const reaches = (hash: string) => capability_id === undefined || hash === capability_id ||
    in_causal_past({ entries: oplog.entries, ancestor: capability_id, next: [hash] })
  if (heads.length > MAX_CITED_HEADS && !next.some(reaches)) {
    const head = heads.slice(MAX_CITED_HEADS).find(reaches)
    if (head !== undefined) next[next.length - 1] = head
  }
  return next.sort()
}

// Signs and appends a local operation: next follows §4.2, and the entry passes
// the same verification as a remote one. A duplicate PUT (§2.10) is rejected
// before anything is appended. Also reports what a revocation changed.
export const append_entry_with_access = ({ oplog, payload, key_pair }: {
  oplog: Oplog
  payload: unknown
  key_pair: KeyPair
}): { entry: VerifiedEntry, access: AccessChange } => {
  assert_not_duplicate({ oplog, payload })
  const capability_id = is_record(payload) && typeof payload.capability_id === 'string' ? payload.capability_id : undefined
  const next = select_next(oplog, capability_id)
  const time = next.reduce((max, hash) => Math.max(max, clock_of(oplog, hash)), 0) + 1
  const unsigned_entry = build_unsigned_entry({ id: oplog.chain.address, payload, next, refs: [], clock: { id: key_pair.public_key, time } })
  const hashed = hash_signed_entry(sign_entry({ unsigned_entry, private_key: key_pair.private_key }))
  const entry = verify_entry({ oplog, hashed })
  insert_entry({ oplog, entry })
  const access = refresh_access_state({ oplog, added: [entry] })
  refresh_current_state({ oplog, keys: entry.state_key === undefined ? access.keys : new Set([...access.keys, entry.state_key]) })
  return { entry, access }
}

export const append_entry = (input: { oplog: Oplog, payload: unknown, key_pair: KeyPair }): VerifiedEntry =>
  append_entry_with_access(input).entry
