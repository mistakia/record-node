// PUT and DEL operations (§2.8) and per-library-type payload validation:
// envelopes and access records in a recordstore (§2.8.1, §3.5.5), listen
// writes in a listens library (§2.7), and records in an identity library
// (§4.8.2).

import { is_access_record_type, validate_access_record } from '#access-control/capability-record.ts'
import type {
  AccessRecordPut, DelOperation, DeletableType, Envelope, EntryPayload, IdentityOperation, OpaqueOperation, Operation, PutOperation
} from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import type { LibraryType } from '#types/library.ts'
import { ENVELOPE_TYPES, validate_envelope } from './envelope.ts'
import { is_identity_record_type, validate_identity_operation } from './identity-record.ts'
import { validate_listen_payload } from './listen.ts'

const DELETABLE_TYPES: readonly DeletableType[] = ['track', 'log']
const DEL_VALUE_FIELDS = ['type', 'timestamp']

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

const validate_del_value = (value: unknown): DelOperation['value'] => {
  if (!is_record(value)) throw invalid('DEL value must be a map')
  const fields = Object.keys(value)
  // Exactly {type, timestamp}: no content CID or anything else rides on a DEL.
  if (fields.length !== DEL_VALUE_FIELDS.length || !DEL_VALUE_FIELDS.every((field) => fields.includes(field))) {
    throw invalid('DEL value carries exactly type and timestamp, and no content CID')
  }
  if (!DELETABLE_TYPES.includes(value.type as DeletableType)) {
    throw invalid(`DEL value.type must be track or log, not ${String(value.type)}; about entries are never deleted`)
  }
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) {
    throw invalid('DEL timestamp must be unsigned integer milliseconds')
  }
  return { type: value.type as DeletableType, timestamp: value.timestamp as number }
}

export const build_del_operation = ({ key, type, timestamp = Date.now() }: {
  key: string
  type: DeletableType
  timestamp?: number
}): DelOperation => Object.freeze({ op: 'DEL', key, value: validate_del_value({ type, timestamp }) })

// A PUT value of a type this version does not define merges with no effect,
// but only from a write-list signer, which authorisation checks (§4.4.1).
const validate_recordstore_operation = (payload: unknown): Operation | AccessRecordPut | OpaqueOperation => {
  if (!is_record(payload)) throw invalid('an operation must be a map')
  if (typeof payload.key !== 'string') throw invalid('operation key must be a string')
  const capability_id = typeof payload.capability_id === 'string' ? payload.capability_id : undefined
  const { key, value } = payload
  if (payload.op === 'PUT') {
    if (is_record(value) && is_access_record_type(value.type)) {
      validate_access_record({ key, value })
      return with_capability({ op: 'PUT', key, value: value as AccessRecordPut['value'] }, capability_id)
    }
    if (is_record(value) && typeof value.type === 'string' && !ENVELOPE_TYPES.includes(value.type as Envelope['type'])) {
      return with_capability({ op: 'PUT', key, value, opaque: true as const }, capability_id)
    }
    const envelope = validate_envelope(value)
    if (key !== envelope.id) throw invalid('PUT key must equal the envelope id')
    return with_capability({ op: 'PUT', key, value: envelope }, capability_id)
  }
  if (payload.op === 'DEL') return with_capability({ op: 'DEL', key, value: validate_del_value(value) }, capability_id)
  throw invalid(`unknown operation ${String(payload.op)}`)
}

// The operation check of append verification (§2.8.2, §3.5.4, §4.5).
export const validate_operation = ({ payload, library_type }: {
  payload: unknown
  library_type: LibraryType
}): EntryPayload => {
  if (library_type === 'identity') return validate_identity_operation(payload)
  if (library_type === 'recordstore') return validate_recordstore_operation(payload)
  if (is_record(payload) && 'capability_id' in payload) throw invalid('a listens library entry never carries capability_id')
  return validate_listen_payload(payload)
}

const is_opaque = (payload: EntryPayload): payload is OpaqueOperation => 'opaque' in payload

// A Track, Log, or About envelope PUT.
export const is_put = (payload: EntryPayload): payload is PutOperation =>
  'op' in payload && payload.op === 'PUT' && !is_opaque(payload) && ENVELOPE_TYPES.includes(payload.value.type as Envelope['type'])

// An envelope PUT or a track or log DEL: the operations current-state
// resolution keys in a recordstore.
export const is_envelope_operation = (payload: EntryPayload): payload is Operation =>
  is_put(payload) || ('op' in payload && payload.op === 'DEL' && !is_opaque(payload) && DELETABLE_TYPES.includes(payload.value.type as DeletableType))

export const is_access_record = (payload: EntryPayload): payload is AccessRecordPut =>
  'op' in payload && payload.op === 'PUT' && !is_opaque(payload) && is_access_record_type(payload.value.type)

export const is_identity_operation = (payload: EntryPayload): payload is IdentityOperation =>
  'op' in payload && !is_opaque(payload) && is_identity_record_type(payload.value.type)
