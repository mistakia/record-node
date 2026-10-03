// Capability and revocation records (§3.5.5, §3.5.6, §3.5.8, §3.5.10): their
// shapes, the operation key derived from the record, and the grantee and
// condition checks. A record of a defined type that breaks its shape rejects
// the entry; an unknown GranteeSpec, filter node, condition, or capability
// field merges but grants nothing.

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { is_compressed_pubkey } from '#identity/key-pair.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import { filter_shape, has_extra_fields, worst_shape, type Shape } from './filter.ts'

export const ACCESS_RECORD_TYPES = ['capability', 'revocation'] as const
export type AccessRecordType = typeof ACCESS_RECORD_TYPES[number]

export const ACTIONS = ['library.append_track', 'library.append_tag', 'library.update_about', 'library.grant_capability'] as const
export type Action = typeof ACTIONS[number]

const CAPABILITY_FIELDS = ['type', 'v', 'timestamp', 'grantee', 'actions', 'filter', 'conditions']
const REVOCATION_FIELDS = ['type', 'v', 'timestamp', 'revokes']

const is_uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export const is_access_record_type = (value: unknown): value is AccessRecordType =>
  ACCESS_RECORD_TYPES.includes(value as AccessRecordType)

// The operation key of a record: lowercase-hex sha256 of its dag-cbor value.
export const record_key = (value: unknown): string => bytesToHex(sha256(encode_canonical(value)))

export const grantee_shape = (grantee: unknown): Shape => {
  if (!is_record(grantee) || typeof grantee.type !== 'string') return 'malformed'
  if (grantee.type === 'key') {
    if (!is_compressed_pubkey(grantee.key)) return 'malformed'
    return has_extra_fields(grantee, ['type', 'key']) ? 'unknown' : 'ok'
  }
  if (grantee.type === 'key_set') {
    const { keys } = grantee
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 256 || !keys.every(is_compressed_pubkey)) return 'malformed'
    return has_extra_fields(grantee, ['type', 'keys']) ? 'unknown' : 'ok'
  }
  return 'unknown'
}

export const condition_shape = (condition: unknown): Shape => {
  if (!is_record(condition) || typeof condition.type !== 'string') return 'malformed'
  if (condition.type === 'expires_at') {
    if (!is_uint(condition.at)) return 'malformed'
    return has_extra_fields(condition, ['type', 'at']) ? 'unknown' : 'ok'
  }
  return 'unknown'
}

export const capability_shape = (record: Record<string, unknown>): Shape => {
  const conditions = record.conditions ?? []
  const well_formed = record.v === 1 && is_uint(record.timestamp) && Array.isArray(record.actions) &&
    record.actions.length >= 1 && record.actions.length <= 16 && record.actions.every((action) => typeof action === 'string') &&
    Array.isArray(conditions) && conditions.length <= 16
  if (!well_formed) return 'malformed'
  return worst_shape(
    has_extra_fields(record, CAPABILITY_FIELDS) ? 'unknown' : 'ok',
    grantee_shape(record.grantee),
    record.filter === undefined ? 'ok' : filter_shape(record.filter),
    ...(conditions as unknown[]).map(condition_shape)
  )
}

const revocation_well_formed = (record: Record<string, unknown>): boolean =>
  record.v === 1 && is_uint(record.timestamp) && typeof record.revokes === 'string' && !has_extra_fields(record, REVOCATION_FIELDS)

// Rejects a capability or revocation record that breaks its shape or whose
// operation key is not derived from it.
export const validate_access_record = ({ key, value }: { key: string, value: Record<string, unknown> }): void => {
  if (key !== record_key(value)) throw new ProtocolError('invalid_shape', `a ${String(value.type)} record's key is the sha256 of its value`)
  const well_formed = value.type === 'capability' ? capability_shape(value) !== 'malformed' : revocation_well_formed(value)
  if (!well_formed) throw new ProtocolError('invalid_shape', `malformed ${String(value.type)} record`)
}

export const grantee_matches = (grantee: unknown, key: string): boolean => {
  if (grantee_shape(grantee) !== 'ok') return false
  const spec = grantee as { type: 'key', key: string } | { type: 'key_set', keys: string[] }
  return spec.type === 'key' ? spec.key === key : spec.keys.includes(key)
}

// Every condition holds for an operation timestamped `timestamp`; one of a
// type this version does not define never does.
export const conditions_hold = (conditions: unknown, timestamp: number): boolean =>
  ((conditions ?? []) as unknown[]).every((condition) =>
    condition_shape(condition) === 'ok' && timestamp <= (condition as { at: number }).at)

// A capability carrying a field this version does not define authorises nothing.
export const capability_fails_closed = (record: Record<string, unknown>): boolean =>
  has_extra_fields(record, CAPABILITY_FIELDS)

// A capability a node issues must be one it can verify writes under: every
// action, grantee, filter node, and condition of a type this version defines.
export const assert_issuable_capability = (record: Record<string, unknown>): void => {
  if (capability_shape(record) !== 'ok') throw new ProtocolError('invalid_shape', 'the capability holds a malformed or unrecognised grantee, filter, or condition')
  const unknown = (record.actions as string[]).filter((action) => !ACTIONS.includes(action as Action))
  if (unknown.length > 0) throw new ProtocolError('invalid_shape', `unrecognised actions: ${unknown.join(', ')}`)
}

export const build_capability_record = ({ timestamp = Date.now(), grantee, actions, filter, conditions }: {
  timestamp?: number
  grantee: unknown
  actions: readonly string[]
  filter?: unknown
  conditions?: readonly unknown[] | undefined
}): Record<string, unknown> => ({
  type: 'capability',
  v: 1,
  timestamp,
  grantee,
  actions: [...actions],
  ...(filter === undefined ? {} : { filter }),
  ...(conditions === undefined || conditions.length === 0 ? {} : { conditions: [...conditions] })
})

export const build_revocation_record = ({ timestamp = Date.now(), revokes }: { timestamp?: number, revokes: string }): Record<string, unknown> =>
  ({ type: 'revocation', v: 1, timestamp, revokes })
