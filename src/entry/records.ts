// The inline records of a recordstore or labels library besides access
// records (§2.5, §2.6): label records, keyed by the sha256 of their value,
// and the About record, keyed by sha256("about"). A record that breaks its
// shape, or whose key is not derived from it, rejects the entry.

import { utf8ToBytes } from '@noble/hashes/utils.js'

import { record_key } from '#access-control/capability-record.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { assert_label } from '#encoding/size-bounds.ts'
import type { AboutRecord, LabelPair, LabelsRecord } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'

export const ABOUT_KEY = sha256_hex('about')
export const ABOUT_NAME_MAX_BYTES = 128

const LABELS_FIELDS = ['type', 'v', 'timestamp', 'set', 'unset']
const ABOUT_FIELDS = ['type', 'v', 'timestamp', 'name']
const TRACK_ID_PATTERN = /^[0-9a-f]{64}$/

const invalid = (message: string) => new ProtocolError('invalid_shape', message)

const is_uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

const assert_fields = (value: Record<string, unknown>, fields: readonly string[], what: string) => {
  const extra = Object.keys(value).filter((field) => !fields.includes(field))
  if (extra.length > 0) throw invalid(`${what} carries fields this version does not define: ${extra.join(', ')}`)
}

// The slot one (track_id, label) pair resolves under in its library (§2.5).
// A track id is 64 hex characters, so the label after it needs no escaping.
export const label_state_key = ([track_id, label]: LabelPair): string => `label:${track_id}:${label}`

const LABEL_KEY_PREFIX = 'label:'
const LABEL_KEY_TRACK_END = LABEL_KEY_PREFIX.length + 64

export const is_label_key = (key: string): boolean => key.startsWith(LABEL_KEY_PREFIX)

// The pair a label state key names.
export const label_pair_of = (key: string): LabelPair =>
  [key.slice(LABEL_KEY_PREFIX.length, LABEL_KEY_TRACK_END), key.slice(LABEL_KEY_TRACK_END + 1)]

// The state keys a label record sets, built once per record: a record can
// carry thousands of pairs, and each of them asks.
const set_keys = new WeakMap<LabelsRecord, ReadonlySet<string>>()

// Whether a label record sets the pair under key, rather than unsetting it.
export const applies_label = (record: LabelsRecord, key: string): boolean => {
  let keys = set_keys.get(record)
  if (keys === undefined) {
    keys = new Set(record.set.map(label_state_key))
    set_keys.set(record, keys)
  }
  return keys.has(key)
}

const validate_pair = (pair: unknown): LabelPair => {
  if (!Array.isArray(pair) || pair.length !== 2) throw invalid('a label pair is a [track_id, label] array')
  const [track_id, label] = pair as unknown[]
  if (typeof track_id !== 'string' || !TRACK_ID_PATTERN.test(track_id)) throw invalid('a label pair track_id must be 64 lowercase hex chars')
  return [track_id, assert_label(label)]
}

const validate_pairs = (pairs: unknown, field: 'set' | 'unset'): LabelPair[] => {
  if (!Array.isArray(pairs)) throw invalid(`a label record's ${field} must be an array`)
  return pairs.map(validate_pair)
}

// §2.5: each pair once across set and unset, and at least one pair.
export const validate_labels_record = ({ key, value }: { key: string, value: unknown }): LabelsRecord => {
  if (!is_record(value) || value.type !== 'labels') throw invalid('a label record must be a map of type labels')
  assert_fields(value, LABELS_FIELDS, 'a label record')
  if (value.v !== 1) throw invalid('label record v must be 1')
  if (!is_uint(value.timestamp)) throw invalid('label record timestamp must be unsigned integer milliseconds')
  const set = validate_pairs(value.set, 'set')
  const unset = validate_pairs(value.unset, 'unset')
  if (set.length + unset.length === 0) throw invalid('a label record names at least one pair')
  const keys = new Set([...set, ...unset].map(label_state_key))
  if (keys.size !== set.length + unset.length) throw invalid('a label record names a pair more than once')
  if (key !== record_key(value)) throw invalid('a label record\'s key is the sha256 of its value')
  return { type: 'labels', v: 1, timestamp: value.timestamp, set, unset }
}

export const validate_about_record = ({ key, value }: { key: string, value: unknown }): AboutRecord => {
  if (!is_record(value) || value.type !== 'about') throw invalid('an About record must be a map of type about')
  assert_fields(value, ABOUT_FIELDS, 'an About record')
  if (value.v !== 1) throw invalid('About record v must be 1')
  if (!is_uint(value.timestamp)) throw invalid('About record timestamp must be unsigned integer milliseconds')
  const { name } = value
  if (typeof name !== 'string' || name.length === 0 || utf8ToBytes(name).length > ABOUT_NAME_MAX_BYTES) {
    throw invalid(`an About name must be 1 to ${ABOUT_NAME_MAX_BYTES} UTF-8 bytes`)
  }
  if (key !== ABOUT_KEY) throw invalid('an About record\'s key is sha256("about")')
  return { type: 'about', v: 1, timestamp: value.timestamp, name }
}

export const build_labels_record = ({ set = [], unset = [], timestamp = Date.now() }: {
  set?: readonly LabelPair[]
  unset?: readonly LabelPair[]
  timestamp?: number
}): LabelsRecord => {
  const value = { type: 'labels', v: 1, timestamp, set: set.map((pair) => [...pair]), unset: unset.map((pair) => [...pair]) }
  return Object.freeze(validate_labels_record({ key: record_key(value), value }))
}

export const build_about_record = ({ name, timestamp = Date.now() }: { name: string, timestamp?: number }): AboutRecord =>
  Object.freeze(validate_about_record({ key: ABOUT_KEY, value: { type: 'about', v: 1, timestamp, name } }))
