// The listens library (§2.7, §6.5). A listen is a bare {trackId, address,
// timestamp, clientListenId?} write; the payload builder refuses a missing
// trackId, and the listens library's operation check refuses DEL on append
// and on merge.

import { build_listen_payload } from '#entry/listen.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { LibraryManager } from './library.ts'

export const LISTENS_LIBRARY_NAME = 'listens'

export const record_listen = async ({ libraries, listens_address, key_pair, track_id, address, timestamp, client_listen_id }: {
  libraries: LibraryManager
  listens_address: string
  key_pair: KeyPair
  track_id: string
  // The library the listened track came from.
  address: string
  timestamp?: number
  client_listen_id?: string
}): Promise<VerifiedEntry> => {
  const payload = build_listen_payload({
    track_id,
    address,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(client_listen_id === undefined ? {} : { client_listen_id })
  })
  return await libraries.append({ library_address: listens_address, payload, key_pair })
}
