// F10, record-docs spec/fixtures/gen-capability-vector.mjs (v2.0.0), rebuilt
// with record-node's own signing: every entry, in the same order and with the
// same fields, so C, W, and R hash to the spec's printed values. Each case
// carries the generator's verdict as record-node reports it: accepted, inert,
// or rejected with a ProtocolError code.

import { hexToBytes } from '@noble/hashes/utils.js'

import { record_key } from '#access-control/capability-record.ts'
import { derive_library_address } from '#encoding/library-address.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { hash_signed_entry, type HashedEntry } from '#entry/signed.ts'
import { compressed_pubkey_from_private, type KeyPair } from '#identity/key-pair.ts'
import { sign_entry } from '#identity/signing.ts'
import type { LibraryType } from '#types/library.ts'
import type { UnsignedEntry } from '#types/entry.ts'
import type { ProtocolErrorCode } from '#types/errors.ts'

export type Verdict = 'accept' | 'inert' | ProtocolErrorCode

export interface VectorCase {
  readonly label: string
  readonly library: LibraryType
  readonly hashed: HashedEntry
  readonly verdict: Verdict
}

// The vector's test keys k = 1 to 4. k = 1 is refused as a real identity, so
// these are built directly rather than through key_pair_from_private_key.
export const test_key = (k: number): KeyPair => {
  const private_key = hexToBytes(k.toString(16).padStart(64, '0'))
  return { private_key, public_key: compressed_pubkey_from_private(private_key) } as KeyPair
}

const [OWNER, K2, K3, K4] = [1, 2, 3, 4].map(test_key) as [KeyPair, KeyPair, KeyPair, KeyPair]
export const OWNER_KEY = OWNER

const address_of = (type: LibraryType, discriminator: string) =>
  derive_library_address({ key: OWNER.public_key, type, discriminator })
export const LIBRARY_ADDRESSES = {
  recordstore: address_of('recordstore', 'library'),
  labels: address_of('labels', 'labels'),
  listens: address_of('listens', 'listens'),
  identity: address_of('identity', 'identity')
} as const

// §2.2.1 F2 track content CID.
const TRACK_CONTENT = 'zBwWX8s8jVcoQvakEsZzXaVeakz5eXiyaqb6jPBdQ4wYyz2LT8iKXYneYTrRWxqtEhcyyv8sMcL5ivsGosuE4saCCimeb'
const ABOUT_KEY = sha256_hex('about')
const TRACK_A = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const TRACK_B = sha256_hex('track-b')
const TRACK_T = sha256_hex('track-t')
const T0 = 1700000000000
const EXPIRES_AT = T0 + 100000

const track = (id: string, timestamp: number) => ({ id, timestamp, v: 1, type: 'track', content: TRACK_CONTENT })
const about = (timestamp: number) => ({ type: 'about', v: 1, timestamp, name: 'Library' })
const labels = (timestamp: number, set: Array<[string, string]> = [], unset: Array<[string, string]> = []) =>
  ({ type: 'labels', v: 1, timestamp, set, unset })
const capability = (fields: Record<string, unknown>) => ({ type: 'capability', v: 1, ...fields })
const revocation = (timestamp: number, revokes: string) => ({ type: 'revocation', v: 1, timestamp, revokes })
const grant = (key: KeyPair, actions: string[], extra: Record<string, unknown> = {}) =>
  ({ grantee: { type: 'key', key: key.public_key }, actions, ...extra })

export const build_capability_vector = () => {
  const cases: VectorCase[] = []
  const entries = new Map<string, HashedEntry>()

  // The clock follows §4.2 unless a case forges it.
  const append = (label: string, verdict: Verdict, { k, next = [], value, op = 'PUT', key, capability_id, library = 'recordstore', time, payload }: {
    k: KeyPair
    next?: string[]
    value?: Record<string, unknown>
    op?: 'PUT' | 'DEL'
    key?: string
    capability_id?: string
    library?: LibraryType
    time?: number
    payload?: Record<string, unknown>
  }): string => {
    const body: Record<string, unknown> = payload ?? { op, key: key ?? record_key(value), value }
    if (capability_id !== undefined) body.capability_id = capability_id
    const clock_time = time ?? (next.length > 0 ? Math.max(...next.map((hash) => (entries.get(hash) as HashedEntry).entry.clock.time)) + 1 : 1)
    const unsigned_entry = { id: LIBRARY_ADDRESSES[library], payload: body, next, refs: [], v: 2, clock: { id: k.public_key, time: clock_time } } as unknown as UnsignedEntry
    const hashed = hash_signed_entry(sign_entry({ unsigned_entry, private_key: k.private_key }))
    entries.set(hashed.hash, hashed)
    cases.push({ label, library, hashed, verdict })
    return hashed.hash
  }
  type Extra = { key?: string, capability_id?: string, time?: number }
  const put_labels = (label: string, verdict: Verdict, k: KeyPair, next: string[], value: Record<string, unknown>, extra: Extra = {}) =>
    append(label, verdict, { k, next, value, ...extra })

  // Capability C and its revocation.
  const MIX = { type: 'prefix', field: 'label', prefix: 'mix/' }
  const C = append('C: k=2 may write mix/ labels until an expiry', 'accept', {
    k: OWNER,
    value: capability({ timestamp: T0, ...grant(K2, ['library.write_label']), filter: MIX, conditions: [{ type: 'expires_at', at: EXPIRES_AT }] })
  })
  const W = put_labels('W: k=2 labels track A mix/friends under C', 'accept', K2, [C], labels(T0 + 1000, [[TRACK_A, 'mix/friends']]), { capability_id: C })
  const R = append('R: owner revokes C, having seen W', 'accept', { k: OWNER, next: [W], value: revocation(T0 + 2000, C) })
  put_labels('k=2 label write under C, concurrent with R', 'inert', K2, [W], labels(T0 + 2500, [[TRACK_B, 'mix/friends']]), { capability_id: C })
  put_labels('k=2 label write under C with R in its causal past', 'capability_revoked', K2, [R], labels(T0 + 3000, [[TRACK_B, 'mix/friends']]), { capability_id: C })

  // One reject per check.
  const under_c = (label: string, verdict: Verdict, k: KeyPair, value: Record<string, unknown>, extra: Extra = {}) =>
    put_labels(label, verdict, k, [C], value, { capability_id: C, ...extra })
  under_c('label write under C signed by k=3', 'capability_denied', K3, labels(T0 + 1000, [[TRACK_B, 'mix/friends']]))
  under_c('label other under C', 'capability_denied', K2, labels(T0 + 1000, [[TRACK_B, 'other']]))
  under_c('mix/a and other in one record under C', 'capability_denied', K2, labels(T0 + 1000, [[TRACK_B, 'mix/a'], [TRACK_B, 'other']]))
  under_c('label write under C after the expiry', 'capability_expired', K2, labels(EXPIRES_AT + 1, [[TRACK_B, 'mix/friends']]))
  under_c('About PUT under C', 'capability_denied', K2, about(T0 + 1000), { key: ABOUT_KEY })
  under_c('track PUT under C', 'capability_denied', K2, track(TRACK_B, T0 + 1000), { key: TRACK_B })
  under_c('label write under C with a forged clock.time', 'invalid_clock', K2, labels(T0 + 1000, [[TRACK_B, 'mix/friends']]), { time: 9 })
  put_labels('label write citing C with C outside its causal past', 'capability_denied', K2, [], labels(T0 + 1000, [[TRACK_B, 'mix/friends']]), { capability_id: C })
  put_labels('label write by k=2 with no capability_id', 'unauthorised_writer', K2, [C], labels(T0 + 1000, [[TRACK_B, 'mix/friends']]))

  // Shapes and fail-closed types.
  append('owner capability with no actions (malformed)', 'invalid_shape', { k: OWNER, value: capability({ timestamp: T0 + 1, ...grant(K2, []) }) })
  const fail_closed = (label: string, fields: Record<string, unknown>, timestamp: number) =>
    append(label, 'accept', { k: OWNER, value: capability({ timestamp, ...fields }) })
  const U = fail_closed('owner capability, filter not over an unknown node', {
    ...grant(K2, ['library.write_label']), filter: { type: 'not', filter: { type: 'regex', field: 'label', pattern: '^x' } }
  }, T0 + 10)
  put_labels('label write under the unknown-filter capability', 'capability_denied', K2, [U], labels(T0 + 1000, [[TRACK_B, 'mix/friends']]), { capability_id: U })
  const UG = fail_closed('owner capability with an unknown grantee type', {
    grantee: { type: 'group', name: 'friends' }, actions: ['library.append_track']
  }, T0 + 11)
  append('write under the unknown-grantee capability', 'capability_denied', {
    k: K2, next: [UG], key: TRACK_B, capability_id: UG, value: track(TRACK_B, T0 + 1000)
  })
  const UC = fail_closed('owner capability with an unknown condition type', {
    ...grant(K2, ['library.append_track']), conditions: [{ type: 'before_block', height: 1 }]
  }, T0 + 12)
  append('write under the unknown-condition capability', 'capability_denied', {
    k: K2, next: [UC], key: TRACK_B, capability_id: UC, value: track(TRACK_B, T0 + 1000)
  })
  append('owner track PUT carrying capability_id (ignored)', 'accept', {
    k: OWNER, next: [C], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000)
  })
  append('listen by k=2 carrying capability_id, listens library', 'invalid_operation', {
    k: K2, library: 'listens', payload: { trackId: TRACK_A, address: LIBRARY_ADDRESSES.recordstore, timestamp: T0 }, capability_id: C
  })
  append('owner link PUT carrying capability_id, identity library', 'invalid_operation', {
    k: OWNER,
    library: 'identity',
    key: sha256_hex(LIBRARY_ADDRESSES.recordstore),
    capability_id: C,
    value: { type: 'link', v: 1, timestamp: T0, address: LIBRARY_ADDRESSES.recordstore }
  })
  append('owner label record carrying capability_id, labels library', 'invalid_operation', {
    k: OWNER, library: 'labels', capability_id: C, value: labels(T0, [[TRACK_A, 'mix/friends']])
  })

  // Label records (§2.5) and the labels library (§4.9).
  const T = fail_closed('T: owner grants k=2 write_label', grant(K2, ['library.write_label']), T0 + 20)
  const TL = put_labels('k=2 labels track T, which no library holds, under T', 'accept', K2, [T],
    labels(T0 + 21, [[TRACK_T, 'a'], [TRACK_T, 'b']]), { capability_id: T })
  put_labels('k=2 unsets a and sets c on track T under T', 'accept', K2, [TL], labels(T0 + 22, [[TRACK_T, 'c']], [[TRACK_T, 'a']]), { capability_id: T })
  append('owner label record with a mismatched key', 'invalid_shape', { k: OWNER, key: sha256_hex('labels'), value: labels(T0 + 23, [[TRACK_T, 'a']]) })
  const malformed_labels: Array<[string, Verdict, Record<string, unknown>]> = [
    ['a pair in both set and unset', 'invalid_shape', labels(T0 + 24, [[TRACK_T, 'a']], [[TRACK_T, 'a']])],
    ['no pairs', 'invalid_shape', labels(T0 + 25)],
    ['a label not in NFC', 'invalid_shape', labels(T0 + 26, [[TRACK_T, 'cafe\u0301']])],
    ['a label with a control character', 'invalid_shape', labels(T0 + 27, [[TRACK_T, 'a\u0007']])],
    // The label bound is a §2.8.3 size bound, so it reports as one.
    ['a label over 128 bytes', 'size_exceeded', labels(T0 + 28, [[TRACK_T, 'x'.repeat(129)]])],
    ['an uppercase track id', 'invalid_shape', labels(T0 + 29, [[TRACK_T.toUpperCase(), 'a']])]
  ]
  for (const [what, verdict, value] of malformed_labels) append(`owner label record with ${what}`, verdict, { k: OWNER, value })
  append('owner About PUT with a bio (malformed)', 'invalid_shape', { k: OWNER, key: ABOUT_KEY, value: { ...about(T0 + 30), bio: 'x' } })
  append('owner label record, labels library', 'accept', { k: OWNER, library: 'labels', value: labels(T0 + 31, [[TRACK_A, 'lifestream-radio']]) })
  append('owner About PUT, labels library', 'accept', { k: OWNER, library: 'labels', key: ABOUT_KEY, value: about(T0 + 32) })
  append('owner track PUT, labels library', 'invalid_operation', { k: OWNER, library: 'labels', key: TRACK_A, value: track(TRACK_A, T0 + 33) })
  append('owner DEL, labels library', 'invalid_operation', {
    k: OWNER, library: 'labels', op: 'DEL', key: TRACK_A, value: { type: 'track', timestamp: T0 + 34 }
  })
  append('owner DEL of an About record', 'invalid_operation', { k: OWNER, op: 'DEL', key: ABOUT_KEY, value: { type: 'about', timestamp: T0 + 35 } })
  append('label record by k=2, labels library', 'unauthorised_writer', { k: K2, library: 'labels', value: labels(T0 + 36, [[TRACK_A, 'a']]) })

  // Delegation.
  const D = fail_closed('D: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 30)
  const D1 = append('D1: k=2 grants k=3 append_track under D', 'accept', {
    k: K2,
    next: [D],
    capability_id: D,
    value: capability({ timestamp: T0 + 31, grantee: { type: 'key_set', keys: [K3.public_key] }, actions: ['library.append_track'] })
  })
  const DW = append('k=3 write under D1', 'accept', { k: K3, next: [D1], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 32) })
  const D2 = append('D2: k=2 grants k=3 update_about under D', 'accept', {
    k: K2, next: [D], capability_id: D, value: capability({ timestamp: T0 + 33, ...grant(K3, ['library.update_about']) })
  })
  append('k=3 About PUT under D2, which D does not cover', 'capability_denied', {
    k: K3, next: [D2], key: ABOUT_KEY, capability_id: D2, value: about(T0 + 34)
  })
  const DR = append('DR: k=2 revokes D1, which it issued', 'accept', { k: K2, next: [DW], capability_id: D, value: revocation(T0 + 35, D1) })
  append('k=3 write under D1 with DR in its causal past', 'capability_revoked', {
    k: K3, next: [DR], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 36)
  })
  append('k=3 write under D1 concurrent with DR', 'inert', { k: K3, next: [DW], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 38) })
  append('k=3 revokes D2, which it did not issue', 'capability_denied', { k: K3, next: [D1, D2], capability_id: D1, value: revocation(T0 + 37, D2) })

  const F = fail_closed('F: owner grants k=2 grant and write_label, mix/ only', {
    ...grant(K2, ['library.grant_capability', 'library.write_label']), filter: MIX
  }, T0 + 40)
  const F1 = append('F1: k=2 grants k=3 write_label under the filtered F', 'accept', {
    k: K2, next: [F], capability_id: F, value: capability({ timestamp: T0 + 41, ...grant(K3, ['library.write_label']) })
  })
  put_labels('k=3 unsets mix/friends under F1', 'accept', K3, [F1], labels(T0 + 42, [], [[TRACK_B, 'mix/friends']]), { capability_id: F1 })
  put_labels('k=3 labels other under F1', 'capability_denied', K3, [F1], labels(T0 + 43, [[TRACK_B, 'other']]), { capability_id: F1 })

  const E = fail_closed('E: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 50)
  const E1 = append('E1: k=2 grants k=3 append_track under E', 'accept', {
    k: K2, next: [E], capability_id: E, value: capability({ timestamp: T0 + 51, ...grant(K3, ['library.append_track']) })
  })
  const RE = append('owner revokes E, the parent of E1', 'accept', { k: OWNER, next: [E1], value: revocation(T0 + 52, E) })
  append('k=3 write under E1 after its parent is revoked', 'capability_revoked', {
    k: K3, next: [RE], key: TRACK_B, capability_id: E1, value: track(TRACK_B, T0 + 53)
  })

  let G = fail_closed('G1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 60)
  for (let i = 2; i <= 9; i++) {
    G = append(`G${i}: k=2 regrants to itself under G${i - 1}`, 'accept', {
      k: K2,
      next: [G],
      capability_id: G,
      value: capability({ timestamp: T0 + 60 + i, ...grant(K2, ['library.grant_capability', 'library.append_track']) })
    })
  }
  append('k=2 write under G9, a chain of 9', 'capability_denied', { k: K2, next: [G], key: TRACK_B, capability_id: G, value: track(TRACK_B, T0 + 70) })

  const S1 = fail_closed('S1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 80)
  const S2 = append('S2: k=2 grants itself append_track under S1', 'accept', {
    k: K2, next: [S1], capability_id: S1, value: capability({ timestamp: T0 + 81, ...grant(K2, ['library.append_track']) })
  })
  const RS = append('k=2 revokes S2 citing S2 (self-reference)', 'inert', { k: K2, next: [S2], capability_id: S2, value: revocation(T0 + 82, S2) })
  append('k=2 write under S2 after the inert self-revocation', 'accept', { k: K2, next: [RS], key: TRACK_B, capability_id: S2, value: track(TRACK_B, T0 + 83) })

  // Two interacting delegated revocations: RA (k=3 revokes E, citing H2) and
  // RB (k=2 revokes H2) are concurrent, and RA has the lower clock.
  const H1 = fail_closed('H1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 90)
  const H2 = append('H2: k=2 grants k=3 grant and append under H1', 'accept', {
    k: K2, next: [H1], capability_id: H1, value: capability({ timestamp: T0 + 91, ...grant(K3, ['library.grant_capability', 'library.append_track']) })
  })
  const HE = append('E: k=3 grants k=4 append_track under H2', 'accept', {
    k: K3, next: [H2], capability_id: H2, value: capability({ timestamp: T0 + 92, ...grant(K4, ['library.append_track']) })
  })
  const RA = append('RA: k=3 revokes E citing H2 (clock 4)', 'accept', { k: K3, next: [HE], capability_id: H2, value: revocation(T0 + 93, HE) })
  const HY = append('Y: k=4 write under E, concurrent with RA', 'inert', { k: K4, next: [HE], key: TRACK_B, capability_id: HE, value: track(TRACK_B, T0 + 94) })
  const HW = append('k=2 write under H1', 'accept', { k: K2, next: [HE], key: TRACK_A, capability_id: H1, value: track(TRACK_A, T0 + 95) })
  const RB = append('RB: k=2 revokes H2 (clock 5), concurrent with RA', 'accept', { k: K2, next: [HW, HY], capability_id: H1, value: revocation(T0 + 96, H2) })

  // Head fan-out (§4.2, §5.4.2 item 2).
  const SP = fail_closed('SP: owner grants k=2 append_track', grant(K2, ['library.append_track']), T0 + 100)
  const spam: string[] = []
  for (let i = 0; i < 257; i++) {
    const id = sha256_hex(`spam-${i}`)
    spam.push(append(`spam ${i}`, 'accept', { k: K2, next: [SP], key: id, capability_id: SP, value: track(id, T0 + 101 + i) }))
  }
  const by_hash = [...spam].sort()
  const O1 = append('owner append citing 256 of 257 heads', 'accept', {
    k: OWNER, next: by_hash.slice(0, 256), key: sha256_hex('owner-1'), value: track(sha256_hex('owner-1'), T0 + 400)
  })
  const O2 = append('owner append citing the last spam head and O1', 'accept', {
    k: OWNER, next: [by_hash[256] as string, O1], key: sha256_hex('owner-2'), value: track(sha256_hex('owner-2'), T0 + 401)
  })
  append('owner append citing all 257 heads', 'size_exceeded', {
    k: OWNER, next: by_hash, key: sha256_hex('owner-3'), value: track(sha256_hex('owner-3'), T0 + 402)
  })

  return { cases, hashes: { C, W, R, RE, DR, RA, RB, SP, O2 } }
}
