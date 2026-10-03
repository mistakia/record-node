// Indexed entries as WebSocket events (x-websocket-events in 7-http-api.yaml).

import { is_envelope_operation, is_put } from '#entry/operations.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { get_library_summary, get_track } from '#query-db/queries.ts'
import type { PeerContext } from './context.ts'
import { to_api_track } from './views.ts'

export const project_entry_events = ({ context, library_address, entries }: {
  context: PeerContext
  library_address: string
  entries: readonly VerifiedEntry[]
}): void => {
  const { emit } = context.events
  const own_library_address = context.identity?.own_address ?? ''
  for (const { operation } of entries) {
    if (!is_envelope_operation(operation) || operation.value.type !== 'track') continue
    const track_id = operation.key
    if (!is_put(operation)) {
      emit({ type: 'track:removed', payload: { library_address, track_id } })
      continue
    }
    const row = get_track({ db: context.db, track_id, own_library_address, library_addresses: [library_address] })
    const track = row === undefined ? undefined : to_api_track(row)
    if (track !== undefined) emit({ type: 'track:added', payload: { library_address, track } })
  }
  const { track_count, linked_library_count } = get_library_summary({ db: context.db, library_address })
  emit({
    type: 'library:index-updated',
    payload: { library_address, track_count, linked_library_count, is_processing_index: false, processing_count: 0 }
  })
}
