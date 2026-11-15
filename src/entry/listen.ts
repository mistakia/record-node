// Listens-library payloads (§2.7, §6.5): the bare {trackId, address,
// timestamp, clientListenId?} object. There is no DEL; listens are
// append-only.

import type { ListenPayload } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'

// §2.7: a key outside this pattern is treated as absent, never rejected, so a
// malformed key leaves what verify_entry accepts unchanged.
export const CLIENT_LISTEN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export const validate_listen_payload = (value: unknown): ListenPayload => {
  if (!is_record(value)) throw new ProtocolError('invalid_operation', 'a listen payload must be a map')
  if ('op' in value) throw new ProtocolError('invalid_operation', 'a listens library accepts only listen writes, never PUT or DEL')
  const { trackId, address, timestamp, clientListenId } = value
  if (typeof trackId !== 'string' || trackId.length === 0) throw new ProtocolError('invalid_operation', 'a listen write requires trackId')
  if (typeof address !== 'string') throw new ProtocolError('invalid_operation', 'a listen write requires address')
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) < 0) {
    throw new ProtocolError('invalid_operation', 'a listen timestamp must be unsigned integer milliseconds')
  }
  const listen = { trackId, address, timestamp: timestamp as number }
  return typeof clientListenId === 'string' && CLIENT_LISTEN_ID_PATTERN.test(clientListenId)
    ? { ...listen, clientListenId }
    : listen
}

export const build_listen_payload = ({ track_id, address, timestamp = Date.now(), client_listen_id }: {
  track_id: string
  address: string
  timestamp?: number
  client_listen_id?: string
}): ListenPayload => Object.freeze(validate_listen_payload({
  trackId: track_id,
  address,
  timestamp,
  ...(client_listen_id === undefined ? {} : { clientListenId: client_listen_id })
}))
