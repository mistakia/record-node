// The listens library (§2.7, §6.5): bare listen payloads, append-only. DEL
// is refused on local append and on remote merge by the shared operation
// check, since a listens library validates every payload as a listen write.

import { build_listen_payload } from '#entry/listen.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { ProtocolError } from '#types/errors.ts'
import type { VerifiedEntry } from './accept.ts'
import { append_entry, type Oplog } from './dag.ts'

export const append_listen = ({ oplog, track_id, address, key_pair, timestamp }: {
  oplog: Oplog
  track_id: string
  address: string
  key_pair: KeyPair
  timestamp?: number
}): VerifiedEntry => {
  if (oplog.chain.type !== 'listens') {
    throw new ProtocolError('invalid_operation', `${oplog.chain.address} is not a listens library`)
  }
  const payload = build_listen_payload(timestamp === undefined ? { track_id, address } : { track_id, address, timestamp })
  return append_entry({ oplog, payload, key_pair })
}
