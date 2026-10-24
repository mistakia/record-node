// Library announcements on RECORD (§5.3): one announcement when this peer
// joins the topic, and for each remote peer join at most one per 5 seconds
// per target peer, with simultaneous joins batched into one message. Library
// state changes are never announced here; they replicate on the per-library
// topics. A received announcement is an untrusted hint until its signed
// entries verify from the JSON alone, under the §5.3.2 trust checks.

import { resolve_ac_chain, type ResolvedAcChain } from '#access-control/resolve.ts'
import { identity_library_address } from '#encoding/library-address.ts'
import { PROFILE_KEY } from '#entry/identity-record.ts'
import { is_about_put, is_identity_operation, validate_operation } from '#entry/operations.ts'
import { ABOUT_KEY } from '#entry/records.ts'
import { assert_signed_entry_shape, hash_signed_entry, type HashedEntry } from '#entry/signed.ts'
import { RECORD_TOPIC, type PubSub } from '#fabric/pubsub.ts'
import { verify_entry_signature } from '#identity/verification.ts'
import { check_entry } from '#oplog/accept.ts'
import type { AboutRecord, ProfileRecord, SignedEntry } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import type { AnnouncedLibrary } from './messages.ts'
import type { Timers } from './timers.ts'

export interface Announcer {
  // This peer joined RECORD.
  announce_self: () => void
  // A remote peer joined RECORD.
  peer_joined: (peer_id: string) => void
  stop: () => void
}

export const create_announcer = ({ pubsub, interval_ms, timers, build }: {
  pubsub: PubSub
  interval_ms: number
  timers: Timers
  // The current announcement, or undefined when there is nothing to announce.
  build: () => Promise<Uint8Array | undefined>
}): Announcer => {
  const last_announced = new Map<string, number>()
  let joined = new Set<string>()
  let scheduled: unknown

  const publish = () => {
    build()
      .then(async (data) => { if (data !== undefined) await pubsub.publish(RECORD_TOPIC, data) })
      .catch((error: unknown) => { process.emitWarning(`announcement failed: ${(error as Error).message}`) })
  }

  const flush = () => {
    scheduled = undefined
    const targets = joined
    joined = new Set()
    const now = timers.now()
    for (const peer_id of targets) last_announced.set(peer_id, now)
    publish()
  }

  return {
    announce_self: publish,
    peer_joined: (peer_id) => {
      const last = last_announced.get(peer_id)
      if (last !== undefined && timers.now() - last < interval_ms) return
      joined.add(peer_id)
      scheduled ??= timers.set_timeout(flush, 0)
    },
    stop: () => {
      if (scheduled !== undefined) timers.clear_timeout(scheduled)
      scheduled = undefined
    }
  }
}

// A signed entry from an announcement, re-encoded to its canonical bytes and
// hash, with its signature verified; undefined when it is malformed or the
// signature fails.
const verified_entry = (value: SignedEntry): HashedEntry | undefined => {
  try {
    const hashed = hash_signed_entry(assert_signed_entry_shape(value))
    return verify_entry_signature({ entry: hashed.entry }) ? hashed : undefined
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
}

export interface VerifiedLibrary {
  readonly chain: ResolvedAcChain
  // The library's About record, when the announcement carried one that verified.
  readonly about?: { readonly hashed: HashedEntry, readonly record: AboutRecord } | undefined
}

// §5.3.2 and §5.3.4 step 2 for one announced library: its AC chain resolves,
// and its about entry, if any, is kept only when it verifies, names the
// library as its id, carries the About record, and is signed by a key of the
// write list. A grantee's About would need its causal past to verify (§3.5.9),
// which an announcement does not carry. Undefined when the chain does not
// resolve; the chain is the read-only handle of step 3, and nothing replicates.
export const verify_announced_library = async ({ announced, get_block }: {
  announced: AnnouncedLibrary
  get_block: (cid: string) => Promise<Uint8Array | undefined>
}): Promise<VerifiedLibrary | undefined> => {
  const { address, about } = announced
  let chain: ResolvedAcChain
  try {
    chain = await resolve_ac_chain({ library_address: address, block_store: { get: get_block, put: async () => {} } })
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
  const hashed = about === undefined ? undefined : verified_entry(about)
  if (hashed === undefined || hashed.entry.id !== address || !chain.write_list.includes(hashed.entry.key)) return { chain }
  try {
    const { operation } = check_entry({ hashed, chain })
    return is_about_put(operation) && operation.key === ABOUT_KEY ? { chain, about: { hashed, record: operation.value } } : { chain }
  } catch (error) {
    if (error instanceof ProtocolError) return { chain }
    throw error
  }
}

export interface VerifiedProfile {
  readonly hashed: HashedEntry
  readonly record: ProfileRecord
}

// §5.3.2: a profile entry verifies when its signature holds, its id is the
// identity library address of its own key, and it carries a profile record
// this node defines. Whose profile it is follows from the key alone.
export const verify_announced_profile = (value: SignedEntry): VerifiedProfile | undefined => {
  const hashed = verified_entry(value)
  if (hashed === undefined || hashed.entry.id !== identity_library_address(hashed.entry.key)) return undefined
  try {
    const operation = validate_operation({ payload: hashed.entry.payload, library_type: 'identity', write_list_signer: true })
    if (!is_identity_operation(operation) || operation.op !== 'PUT' || operation.key !== PROFILE_KEY || operation.value.type !== 'profile') return undefined
    return { hashed, record: operation.value }
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
}
