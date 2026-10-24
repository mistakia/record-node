// Indexed entries as WebSocket events (x-websocket-events in 7-http-api.yaml):
// track changes, label changes, capabilities issued and revoked, and entries
// a revocation made inert (§3.5.10, §8.6.8).

import { is_access_record, is_envelope_operation, is_labels_put, is_put } from '#entry/operations.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { get_library_summary, get_track } from '#query-db/queries.ts'
import { describe_capability, revoked_dependency } from './capabilities.ts'
import type { PeerContext } from './context.ts'
import { identity_state, own_recordstore_addresses } from './ownership.ts'
import { to_api_track } from './views.ts'

// The track ids whose label state label records among the entries name (§2.5).
export const label_track_ids = (entries: readonly VerifiedEntry[]): string[] =>
  [...new Set(entries.flatMap(({ operation }) => is_labels_put(operation) ? [...operation.value.set, ...operation.value.unset].map(([track_id]) => track_id) : []))]

const track_ids_of = (entries: readonly VerifiedEntry[]): string[] => [...new Set([
  ...entries.flatMap(({ operation }) => is_envelope_operation(operation) && operation.value.type === 'track' ? [operation.key] : []),
  ...label_track_ids(entries)
])]

const emit_access_events = ({ context, library_address, entries, inert }: {
  context: PeerContext
  library_address: string
  entries: readonly VerifiedEntry[]
  inert: readonly VerifiedEntry[]
}) => {
  const { emit } = context.events
  const oplog = context.libraries.get(library_address)?.oplog
  if (oplog === undefined) return
  for (const entry of entries) {
    if (!is_access_record(entry.operation)) continue
    if (entry.operation.value.type === 'capability') {
      emit({ type: 'capability:issued', payload: { capability: describe_capability(oplog, entry) } })
      continue
    }
    const revoked = oplog.capabilities.get(entry.operation.value.revokes as string)
    if (revoked !== undefined && oplog.effective.has(entry.hash)) emit({ type: 'capability:revoked', payload: { capability: describe_capability(oplog, revoked) } })
  }
  const by_capability = new Map<string, VerifiedEntry[]>()
  for (const entry of inert) {
    const capability_id = revoked_dependency(oplog, entry)
    if (capability_id !== undefined) by_capability.set(capability_id, [...by_capability.get(capability_id) ?? [], entry])
  }
  for (const [capability_id, group] of by_capability) {
    emit({
      type: 'library:entries-inert',
      payload: {
        library_address,
        capability_id,
        entry_hashes: group.map(({ hash }) => hash),
        label_entry_ids: group.flatMap(({ hash, operation }) => is_labels_put(operation) ? [hash] : []),
        track_ids: track_ids_of(group)
      }
    })
  }
}

export const project_entry_events = ({ context, library_address, entries, inert }: {
  context: PeerContext
  library_address: string
  entries: readonly VerifiedEntry[]
  inert: readonly VerifiedEntry[]
}): void => {
  const { emit } = context.events
  if (context.identity === undefined || library_address === context.identity.identity_address) return
  const own_library_addresses = own_recordstore_addresses(context)
  const pins = identity_state(context).pins
  for (const { operation } of entries) {
    if (!is_envelope_operation(operation) || operation.value.type !== 'track') continue
    const track_id = operation.key
    if (!is_put(operation)) {
      emit({ type: 'track:removed', payload: { library_address, track_id } })
      continue
    }
    const row = get_track({ db: context.db, track_id, own_library_addresses, library_addresses: [library_address] })
    const track = row === undefined ? undefined : to_api_track(row, pins)
    if (track !== undefined) emit({ type: 'track:added', payload: { library_address, track } })
  }
  emit_access_events({ context, library_address, entries, inert })
  const labelled = label_track_ids(entries)
  if (labelled.length > 0) emit({ type: 'library:labels-changed', payload: { library_address, track_ids: labelled } })
  // A batch of label records alone changes no track, so only labels-changed tells of it.
  if (labelled.length > 0 && entries.every(({ operation }) => is_labels_put(operation))) return
  const { track_count } = get_library_summary({ db: context.db, library_address })
  emit({
    type: 'library:index-updated',
    payload: { library_address, track_count, is_processing_index: false, processing_count: 0 }
  })
}
