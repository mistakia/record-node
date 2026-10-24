// The state an identity library records (§4.8.2 to §4.8.4): the libraries
// it claims, retired for good by any DEL, its links, its pins, and its
// profile. Resolution is per (type, key), which the oplog's state keys
// already are. Whether a claimed library is really owned needs its AC chain,
// which the peer checks.

import { is_identity_operation } from '#entry/operations.ts'
import type { IdentityOperation, ProfileRecord } from '#types/entry.ts'
import type { VerifiedEntry } from './accept.ts'
import { compare_current_state } from './current-state.ts'
import type { Oplog } from './dag.ts'

export interface IdentityLibraryState {
  // Every address with a library record, whether a DEL retired it, and its
  // PUT that is least under §4.4.2 order: the oldest, which orders the own
  // libraries (chapter 7 own_library_address).
  readonly libraries: ReadonlyMap<string, { readonly retired: boolean, readonly first_put: VerifiedEntry }>
  // The link set: addresses whose current link record is a PUT.
  readonly links: ReadonlyMap<string, { readonly alias: string | undefined }>
  // Canonical CIDs whose current pin record is a PUT.
  readonly pins: ReadonlySet<string>
  // The current profile record, if any.
  readonly profile: ProfileRecord | undefined
}

const operation_of = (entry: VerifiedEntry | undefined): IdentityOperation | undefined =>
  entry !== undefined && is_identity_operation(entry.operation) ? entry.operation : undefined

// The entry §4.4.2 order sorts last: the least, where the current entry is
// the greatest. The record timestamp stands in for the envelope's (§4.8.2).
export const least_entry = <T extends VerifiedEntry>(entries: readonly T[]): T | undefined =>
  entries.reduce<T | undefined>((least, entry) => least === undefined || compare_current_state(entry, least) > 0 ? entry : least, undefined)

export const identity_library_state = (oplog: Oplog): IdentityLibraryState => {
  const libraries = new Map<string, { retired: boolean, first_put: VerifiedEntry }>()
  const links = new Map<string, { alias: string | undefined }>()
  const pins = new Set<string>()
  let profile: ProfileRecord | undefined
  for (const [state_key, hashes] of oplog.key_entries) {
    const entries = [...hashes].flatMap((hash) => {
      const entry = oplog.entries.get(hash)
      const operation = operation_of(entry)
      return entry === undefined || operation === undefined ? [] : [{ entry, operation }]
    })
    const current = operation_of(oplog.current.get(state_key))
    const type = entries[0]?.operation.value.type
    if (type === 'library') {
      // A DEL names only the key, so the address comes from a PUT for it.
      const first = least_entry(entries.flatMap(({ entry, operation: { op } }) => op === 'PUT' ? [entry] : []))
      const put = operation_of(first)
      if (first !== undefined && put?.op === 'PUT' && put.value.type === 'library') {
        libraries.set(put.value.address, { retired: entries.some(({ operation: { op } }) => op === 'DEL'), first_put: first })
      }
    } else if (type === 'link') {
      if (current?.op === 'PUT' && current.value.type === 'link') links.set(current.value.address, { alias: current.value.alias })
    } else if (type === 'pin') {
      if (current?.op === 'PUT' && current.value.type === 'pin') pins.add(current.value.cid)
    } else if (type === 'profile') {
      if (current?.op === 'PUT' && current.value.type === 'profile') profile = current.value
    }
  }
  return { libraries, links, pins, profile }
}
