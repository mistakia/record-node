// Listens-library payloads (§2.7, §6.5): the bare {trackId, address,
// timestamp} object. There is no DEL; listens are append-only.

import type { ListenPayload } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'

export const validate_listen_payload = (value: unknown): ListenPayload => {
  if (!is_record(value)) throw new ProtocolError('invalid_operation', 'a listen payload must be a map')
  if ('op' in value) throw new ProtocolError('invalid_operation', 'a listens library accepts only listen writes, never PUT or DEL')
  const { trackId, address, timestamp } = value
  if (typeof trackId !== 'string' || trackId.length === 0) throw new ProtocolError('invalid_operation', 'a listen write requires trackId')
  if (typeof address !== 'string') throw new ProtocolError('invalid_operation', 'a listen write requires address')
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) < 0) {
    throw new ProtocolError('invalid_operation', 'a listen timestamp must be unsigned integer milliseconds')
  }
  return { trackId, address, timestamp: timestamp as number }
}

export const build_listen_payload = ({ track_id, address, timestamp = Date.now() }: {
  track_id: string
  address: string
  timestamp?: number
}): ListenPayload => Object.freeze(validate_listen_payload({ trackId: track_id, address, timestamp }))
