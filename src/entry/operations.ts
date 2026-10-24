// PUT and DEL operations (§2.8) and per-library-type payload validation:
// track envelopes and label, About and access records in a recordstore
// (§2.8.1, §3.5.5), label and About records in a labels library (§4.9),
// listen writes in a listens library (§2.7), and records in an identity
// library (§4.8.2).

import { is_access_record_type, record_key, validate_access_record } from '#access-control/capability-record.ts'
import type {
  AboutPut, AccessRecordPut, DelOperation, Envelope, EntryPayload, IdentityOperation, LabelPair, LabelsPut, OpaqueOperation, Operation,
  PutOperation
} from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import type { LibraryType } from '#types/library.ts'
import { validate_envelope } from './envelope.ts'
import { is_identity_record_type, validate_identity_operation } from './identity-record.ts'
import { validate_listen_payload } from './listen.ts'
import { ABOUT_KEY, build_about_record, build_labels_record, validate_about_record, validate_labels_record } from './records.ts'

const DEL_VALUE_FIELDS = ['type', 'timestamp']
const TRACK_ID_PATTERN = /^[0-9a-f]{64}$/

// The PUT value types each record-carrying library type admits (§2.8.1, §4.9).
const ADMITTED_PUTS = {
  recordstore: ['track', 'labels', 'about', 'capability', 'revocation'],
  labels: ['labels', 'about']
} as const

const invalid = (message: string) => new ProtocolError('invalid_operation', message)

// capability_id names the capability a write is made under (§2.8.1).
const with_capability = <T extends object>(operation: T, capability_id: string | undefined): T =>
  Object.freeze(capability_id === undefined ? operation : { ...operation, capability_id })

export const build_put_operation = ({ envelope, capability_id }: { envelope: Envelope, capability_id?: string | undefined }): PutOperation =>
  with_capability({ op: 'PUT', key: envelope.id, value: envelope }, capability_id)

export const build_record_put_operation = ({ key, value, capability_id }: {
  key: string
  value: Record<string, unknown>
  capability_id?: string | undefined
}): AccessRecordPut => with_capability({ op: 'PUT', key, value: value as AccessRecordPut['value'] }, capability_id)

// One label record carrying every given pair (§2.5). The caller omits pairs
// already in the requested state and appends nothing when none remain.
export const build_labels_put = ({ set, unset, timestamp, capability_id }: {
  set?: readonly LabelPair[]
  unset?: readonly LabelPair[]
  timestamp?: number
  capability_id?: string | undefined
}): LabelsPut => {
  const value = build_labels_record({ ...(set === undefined ? {} : { set }), ...(unset === undefined ? {} : { unset }), ...(timestamp === undefined ? {} : { timestamp }) })
  return with_capability({ op: 'PUT', key: record_key(value), value }, capability_id)
}

export const build_about_put = ({ name, timestamp, capability_id }: {
  name: string
  timestamp?: number
  capability_id?: string | undefined
}): AboutPut => with_capability({ op: 'PUT', key: ABOUT_KEY, value: build_about_record({ name, ...(timestamp === undefined ? {} : { timestamp }) }) }, capability_id)

// Exactly {type: "track", timestamp}: labels are unset, never deleted, an
// About record is never deleted, and no content CID rides on a DEL (§2.8.2).
const validate_del_value = (value: unknown): DelOperation['value'] => {
  if (!is_record(value)) throw invalid('DEL value must be a map')
  const fields = Object.keys(value)
  if (fields.length !== DEL_VALUE_FIELDS.length || !DEL_VALUE_FIELDS.every((field) => fields.includes(field))) {
    throw invalid('DEL value carries exactly type and timestamp, and no content CID')
  }
  if (value.type !== 'track') {
    throw invalid(`DEL value.type must be track, not ${String(value.type)}; labels are unset and About records are never deleted`)
  }
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) {
    throw invalid('DEL timestamp must be unsigned integer milliseconds')
  }
  return { type: 'track', timestamp: value.timestamp as number }
}

export const build_del_operation = ({ key, timestamp = Date.now() }: { key: string, timestamp?: number }): DelOperation =>
  Object.freeze({ op: 'DEL', key, value: validate_del_value({ type: 'track', timestamp }) })

// §2.8.4: the Log and About envelopes version 1 wrote, `{id, timestamp, v,
// type, content}` with unknown extras allowed as on any envelope.
const V1_ENVELOPE_TYPES: readonly unknown[] = ['log', 'about']
const is_v1_envelope = (value: Record<string, unknown>): boolean =>
  V1_ENVELOPE_TYPES.includes(value.type) && typeof value.id === 'string' && typeof value.content === 'string' &&
  value.v === 1 && Number.isSafeInteger(value.timestamp) && (value.timestamp as number) >= 0

const validate_record_put = ({ key, value, library_type, write_list_signer }: {
  key: string
  value: Record<string, unknown>
  library_type: 'recordstore' | 'labels'
  write_list_signer: boolean
}): PutOperation | LabelsPut | AboutPut | AccessRecordPut | OpaqueOperation => {
  const type = value.type
  // A version 1 Log or About envelope from a write-list signer merges with no
  // effect, so the history after it still merges (§2.8.4). From anyone else
  // it is a malformed About record, or an undefined type no action authorises.
  if (library_type === 'recordstore' && write_list_signer && is_v1_envelope(value)) return { op: 'PUT', key, value, opaque: true as const }
  // A recordstore merges a PUT of a type this version does not define with
  // no effect, but only from a write-list signer, which authorisation checks
  // (§4.4.1). A labels library admits its two record types and nothing else.
  if (library_type === 'recordstore' && !(ADMITTED_PUTS.recordstore as readonly unknown[]).includes(type)) {
    if (typeof type !== 'string') throw new ProtocolError('invalid_shape', 'a PUT value must carry a string type')
    return { op: 'PUT', key, value, opaque: true as const }
  }
  if (!(ADMITTED_PUTS[library_type] as readonly unknown[]).includes(type)) throw invalid(`a ${library_type} library does not admit a ${String(type)} PUT`)
  if (type === 'labels') return { op: 'PUT', key, value: validate_labels_record({ key, value }) }
  if (type === 'about') return { op: 'PUT', key, value: validate_about_record({ key, value }) }
  if (is_access_record_type(type)) {
    validate_access_record({ key, value })
    return { op: 'PUT', key, value: value as AccessRecordPut['value'] }
  }
  const envelope = validate_envelope(value)
  if (key !== envelope.id) throw invalid('PUT key must equal the envelope id')
  return { op: 'PUT', key, value: envelope }
}

const validate_record_operation = (payload: unknown, library_type: 'recordstore' | 'labels', write_list_signer: boolean): EntryPayload => {
  if (!is_record(payload)) throw invalid('an operation must be a map')
  if (typeof payload.key !== 'string') throw invalid('operation key must be a string')
  // Capabilities exist only in a recordstore (§3.5.5).
  if (library_type === 'labels' && 'capability_id' in payload) throw invalid('a labels library entry never carries capability_id')
  const capability_id = typeof payload.capability_id === 'string' ? payload.capability_id : undefined
  const { key, value } = payload
  if (payload.op === 'PUT') {
    if (!is_record(value)) throw new ProtocolError('invalid_shape', 'a PUT value must be a map')
    return with_capability(validate_record_put({ key, value, library_type, write_list_signer }), capability_id)
  }
  if (payload.op === 'DEL') {
    if (library_type === 'labels') throw invalid('a labels library admits no DEL')
    // A version 1 Log DEL from a write-list signer merges with no effect (§2.8.4).
    if (write_list_signer && is_record(value) && value.type === 'log') return { op: 'DEL', key, value, opaque: true as const }
    // The key is the id of the track it tombstones (§2.2, §2.8.2), so a DEL
    // never names a label pair's state.
    if (!TRACK_ID_PATTERN.test(key)) throw invalid('a DEL key is a track id, 64 lowercase hex chars')
    return with_capability({ op: 'DEL', key, value: validate_del_value(value) }, capability_id)
  }
  throw invalid(`unknown operation ${String(payload.op)}`)
}

// The operation check of append verification (§2.8.2, §3.5.4, §4.5).
// write_list_signer admits the §2.8.4 version 1 entries, which only a
// write-list key's entry may carry; a local write never does.
export const validate_operation = ({ payload, library_type, write_list_signer = false }: {
  payload: unknown
  library_type: LibraryType
  write_list_signer?: boolean
}): EntryPayload => {
  if (library_type === 'identity') return validate_identity_operation(payload)
  if (library_type === 'recordstore' || library_type === 'labels') return validate_record_operation(payload, library_type, write_list_signer)
  if (is_record(payload) && 'capability_id' in payload) throw invalid('a listens library entry never carries capability_id')
  return validate_listen_payload(payload)
}

const is_opaque = (payload: EntryPayload): payload is OpaqueOperation => 'opaque' in payload

const is_put_of = (payload: EntryPayload, type: string): boolean =>
  'op' in payload && payload.op === 'PUT' && !is_opaque(payload) && payload.value.type === type

// A track envelope PUT.
export const is_put = (payload: EntryPayload): payload is PutOperation => is_put_of(payload, 'track')

export const is_labels_put = (payload: EntryPayload): payload is LabelsPut => is_put_of(payload, 'labels')

export const is_about_put = (payload: EntryPayload): payload is AboutPut => is_put_of(payload, 'about')

// A track PUT or DEL: the operations current-state resolution keys by track id.
export const is_envelope_operation = (payload: EntryPayload): payload is Operation =>
  is_put(payload) || ('op' in payload && payload.op === 'DEL' && !is_opaque(payload) && payload.value.type === 'track')

export const is_access_record = (payload: EntryPayload): payload is AccessRecordPut =>
  'op' in payload && payload.op === 'PUT' && !is_opaque(payload) && is_access_record_type(payload.value.type)

export const is_identity_operation = (payload: EntryPayload): payload is IdentityOperation =>
  'op' in payload && !is_opaque(payload) && is_identity_record_type(payload.value.type)
