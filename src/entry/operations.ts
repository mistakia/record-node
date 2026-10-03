// PUT and DEL operations (§2.8) and per-library-type payload validation.

import type { DelOperation, DeletableType, Envelope, EntryPayload, PutOperation } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import type { LibraryType } from '#types/library.ts'
import { validate_envelope } from './envelope.ts'
import { validate_listen_payload } from './listen.ts'

const DELETABLE_TYPES: readonly DeletableType[] = ['track', 'log']
const DEL_VALUE_FIELDS = ['type', 'timestamp']

const invalid = (message: string) => new ProtocolError('invalid_operation', message)

export const build_put_operation = ({ envelope }: { envelope: Envelope }): PutOperation =>
  Object.freeze({ op: 'PUT', key: envelope.id, value: envelope })

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

const validate_recordstore_operation = (payload: unknown): PutOperation | DelOperation => {
  if (!is_record(payload)) throw invalid('an operation must be a map')
  if (typeof payload.key !== 'string') throw invalid('operation key must be a string')
  if (payload.op === 'PUT') {
    const value = validate_envelope(payload.value)
    if (payload.key !== value.id) throw invalid('PUT key must equal the envelope id')
    return { op: 'PUT', key: payload.key, value }
  }
  if (payload.op === 'DEL') return { op: 'DEL', key: payload.key, value: validate_del_value(payload.value) }
  throw invalid(`unknown operation ${String(payload.op)}`)
}

// The operation check of append verification (§2.8.2, §3.5.4, §4.5): a
// listens library takes only listen writes; a recordstore takes PUT and
// track or log DEL.
export const validate_operation = ({ payload, library_type }: {
  payload: unknown
  library_type: LibraryType
}): EntryPayload => library_type === 'listens'
  ? validate_listen_payload(payload)
  : validate_recordstore_operation(payload)

export const is_put = (payload: EntryPayload): payload is PutOperation =>
  'op' in payload && payload.op === 'PUT'

export const is_operation = (payload: EntryPayload): payload is PutOperation | DelOperation =>
  'op' in payload
