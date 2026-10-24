// Library announcements on RECORD (§5.3): one announcement when this peer
// joins the topic, and for each remote peer join at most one per 5 seconds
// per target peer, with simultaneous joins batched into one message. Library
// state changes are never announced here; they replicate on the per-library
// topics. A received announcement is an untrusted hint until
// authenticate_announced has verified it against the library's AC chain.

import { resolve_ac_chain, type ResolvedAcChain } from '#access-control/resolve.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { is_about_put } from '#entry/operations.ts'
import { ABOUT_KEY } from '#entry/records.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { RECORD_TOPIC, type PubSub } from '#fabric/pubsub.ts'
import { check_entry } from '#oplog/accept.ts'
import type { AboutRecord } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import type { AnnouncedLibrary } from './messages.ts'
import type { Timers } from './timers.ts'

const equal_bytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index])

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

export interface AuthenticatedAbout {
  readonly chain: ResolvedAcChain
  readonly about: AboutRecord
}

// §5.3.2: re-fetches the canonical signed entry by hash and accepts the hint
// only when that entry verifies against the library's AC chain as its About
// PUT and the hint carries the payload the entry signs. The resolved chain is
// the read-only handle of §5.3.4 step 3; nothing replicates.
export const authenticate_announced = async ({ announced, get_block }: {
  announced: AnnouncedLibrary
  get_block: (cid: string) => Promise<Uint8Array | undefined>
}): Promise<AuthenticatedAbout | undefined> => {
  const { address, hint } = announced
  try {
    const chain = await resolve_ac_chain({ library_address: address, block_store: { get: get_block, put: async () => {} } })
    const bytes = await get_block(hint.hash)
    if (bytes === undefined) return undefined
    const hashed = decode_signed_entry(bytes)
    if (hashed.hash !== hint.hash || hashed.entry.id !== address) return undefined
    // Only a write-list About is taken as a hint: a grantee's would need its
    // causal past to verify (§3.5.9), which an announcement does not carry.
    const { operation } = check_entry({ hashed, chain })
    if (!chain.write_list.includes(hashed.entry.key)) return undefined
    if (!is_about_put(operation) || operation.key !== ABOUT_KEY) return undefined
    if (!equal_bytes(encode_canonical(hint.payload), encode_canonical(hashed.entry.payload))) return undefined
    return { chain, about: operation.value }
  } catch (error) {
    if (error instanceof ProtocolError) return undefined
    throw error
  }
}
