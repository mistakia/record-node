// Capabilities as the API reports and makes them (§3.5.5, §3.5.10, chapter 7
// Capability): every capability record a library holds, with its status, the
// ones this identity holds, and issuing and revoking them.

import {
  assert_issuable_capability, build_capability_record, build_revocation_record, condition_shape, grantee_matches, record_key
} from '#access-control/capability-record.ts'
import { capability_chain, is_write_list_key } from '#access-control/capability.ts'
import { is_protocol_cid } from '#encoding/cid.ts'
import { build_record_put_operation, is_access_record } from '#entry/operations.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { Oplog } from '#oplog/dag.ts'
import { PeerError, type Capability } from '#types/peer.ts'
import { require_identity, serialise_write, type PeerContext } from './context.ts'
import { append_write, resolve_write_target } from './write-target.ts'

const record_of = (entry: VerifiedEntry): Record<string, unknown> =>
  is_access_record(entry.operation) ? entry.operation.value : {}

const earliest_expiry = (conditions: unknown): number | null => {
  const times = (Array.isArray(conditions) ? conditions as unknown[] : [])
    .filter((condition) => condition_shape(condition) === 'ok')
    .map((condition) => (condition as { at: number }).at)
  return times.length === 0 ? null : Math.min(...times)
}

// The effective revocation naming a capability, if any.
const revocation_of = (oplog: Oplog, capability_id: string): string | null =>
  [...oplog.effective].find((hash) => (record_of(oplog.entries.get(hash) as VerifiedEntry).revokes) === capability_id) ?? null

// A capability is only as usable as its chain (§3.5.9 step 5 and 6): it
// reads as revoked when any capability above it is, and expires with the
// earliest expiry above it. expired is advisory: it reads the node's clock,
// while verification reads each write's own timestamp (§3.5.8).
export const describe_capability = (oplog: Oplog, entry: VerifiedEntry, now = Date.now()): Capability => {
  const record = record_of(entry)
  const chain = capability_chain(oplog, entry.hash)
  const revoked_by = chain.map((hash) => revocation_of(oplog, hash)).find((hash) => hash !== null) ?? null
  const expiries = chain.map((hash) => earliest_expiry(record_of(oplog.entries.get(hash) as VerifiedEntry).conditions)).filter((at) => at !== null)
  const expires_at_ms = expiries.length === 0 ? null : Math.min(...expiries)
  const status = revoked_by !== null
    ? 'revoked'
    : oplog.inert.has(entry.hash)
      ? 'inert'
      : expires_at_ms !== null && now > expires_at_ms ? 'expired' : 'active'
  const cited = (entry.operation as { capability_id?: string }).capability_id
  return {
    capability_id: entry.hash,
    library_address: oplog.chain.address,
    issuer: entry.entry.key,
    via_capability_id: is_write_list_key(oplog, entry.entry.key) ? null : cited ?? null,
    grantee: record.grantee as Capability['grantee'],
    actions: Array.isArray(record.actions) ? record.actions.filter((action): action is string => typeof action === 'string') : [],
    filter: (record.filter ?? null) as Capability['filter'],
    conditions: (Array.isArray(record.conditions) ? record.conditions : []) as Capability['conditions'],
    issued_at_ms: record.timestamp as number,
    expires_at_ms,
    status,
    revoked_by
  }
}

export const list_capabilities = (context: PeerContext, address: string): Capability[] => {
  const oplog = context.libraries.get(address)?.oplog
  if (oplog === undefined) throw new PeerError('not_found', `unknown library: ${address}`)
  return [...oplog.capabilities.values()].map((entry) => describe_capability(oplog, entry))
}

// Capabilities in every open recordstore whose grantee matches this identity.
export const held_capabilities = (context: PeerContext): Capability[] => {
  const { public_key } = require_identity(context).key_pair
  return context.libraries.list().flatMap(({ oplog }) => [...oplog.capabilities.values()]
    .filter((entry) => grantee_matches(record_of(entry).grantee, public_key))
    .map((entry) => describe_capability(oplog, entry)))
}

// The active capabilities this identity holds in one library.
export const held_capability_ids = (context: PeerContext, address: string): string[] => {
  const oplog = context.libraries.get(address)?.oplog
  if (oplog === undefined) return []
  const { public_key } = require_identity(context).key_pair
  return [...oplog.capabilities.values()]
    .filter((entry) => grantee_matches(record_of(entry).grantee, public_key))
    .map((entry) => describe_capability(oplog, entry))
    .filter(({ status }) => status === 'active')
    .map(({ capability_id }) => capability_id)
}

// The node issues only what it could verify writes under (§3.5.5).
export const issue_capability = async (context: PeerContext, { library_address, grantee, actions, filter, conditions, capability_id }: {
  library_address: string
  grantee: unknown
  actions: readonly string[]
  filter?: unknown
  conditions?: readonly unknown[] | undefined
  capability_id?: string | undefined
}): Promise<Capability> => await serialise_write(context, async () => {
  const target = resolve_write_target(context, { library_address, capability_id })
  const value = build_capability_record({ grantee, actions, filter, conditions })
  assert_issuable_capability(value)
  const entry = await append_write(context, target, build_record_put_operation({ key: record_key(value), value, capability_id: target.capability_id }))
  return describe_capability(target.handle.oplog, entry)
})

// The owner revokes any capability, including one this node has not merged,
// such as a delegated grant still in flight; another identity, one in whose
// chain it signed, citing a capability it holds (§3.5.10). Verification
// decides.
export const revoke_capability = async (context: PeerContext, { library_address, revokes, capability_id }: {
  library_address: string
  revokes: string
  capability_id?: string | undefined
}): Promise<void> => {
  await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address, capability_id })
    const { oplog } = target.handle
    if (target.capability_id === undefined) {
      if (!is_protocol_cid(revokes)) throw new PeerError('not_found', `not a capability id: ${revokes}`)
      if (revocation_of(oplog, revokes) !== null) return
    } else if (!oplog.capabilities.has(revokes)) {
      throw new PeerError('not_found', `no capability ${revokes} in ${library_address}`)
    }
    const value = build_revocation_record({ revokes })
    await append_write(context, target, build_record_put_operation({ key: record_key(value), value, capability_id: target.capability_id }))
  })
}

// The capability a revoked entry depended on: the first in its chain an
// effective revocation names.
export const revoked_dependency = (oplog: Oplog, entry: VerifiedEntry): string | undefined => {
  const revoked = new Set([...oplog.effective].map((hash) => record_of(oplog.entries.get(hash) as VerifiedEntry).revokes as string))
  return capability_chain(oplog, (entry.operation as { capability_id?: string }).capability_id).find((hash) => revoked.has(hash))
}
