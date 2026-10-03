// The state an identity library records (§4.8.2 to §4.8.4): the libraries
// it claims, retired for good by any DEL, its links, and its pins. Resolution
// is per (type, key), which the oplog's state keys already are. Whether a
// claimed library is really owned needs its AC chain, which the peer checks.

import { is_identity_operation } from '#entry/operations.ts'
import type { IdentityOperation } from '#types/entry.ts'
import type { VerifiedEntry } from './accept.ts'
import type { Oplog } from './dag.ts'

export interface IdentityLibraryState {
  // Every address with a library record, and whether a DEL retired it.
  readonly libraries: ReadonlyMap<string, { readonly retired: boolean }>
  // The link set: addresses whose current link record is a PUT.
  readonly links: ReadonlyMap<string, { readonly alias: string | undefined }>
  // Keys with any link record, PUT or DEL: those addresses ignore legacy Log entries.
  readonly link_keys: ReadonlySet<string>
  // Canonical CIDs whose current pin record is a PUT.
  readonly pins: ReadonlySet<string>
}

const operation_of = (entry: VerifiedEntry | undefined): IdentityOperation | undefined =>
  entry !== undefined && is_identity_operation(entry.operation) ? entry.operation : undefined

export const identity_library_state = (oplog: Oplog): IdentityLibraryState => {
  const libraries = new Map<string, { retired: boolean }>()
  const links = new Map<string, { alias: string | undefined }>()
  const link_keys = new Set<string>()
  const pins = new Set<string>()
  for (const [state_key, hashes] of oplog.key_entries) {
    const operations = [...hashes].flatMap((hash) => operation_of(oplog.entries.get(hash)) ?? [])
    const current = operation_of(oplog.current.get(state_key))
    const [type, key] = [operations[0]?.value.type, operations[0]?.key]
    if (type === 'library') {
      // A DEL names only the key, so the address comes from any PUT for it.
      const address = operations.flatMap(({ op, value }) => op === 'PUT' && value.type === 'library' ? [value.address] : [])[0]
      if (address !== undefined) libraries.set(address, { retired: operations.some(({ op }) => op === 'DEL') })
    } else if (type === 'link' && key !== undefined) {
      link_keys.add(key)
      if (current?.op === 'PUT' && current.value.type === 'link') links.set(current.value.address, { alias: current.value.alias })
    } else if (type === 'pin' && current?.op === 'PUT' && current.value.type === 'pin') {
      pins.add(current.value.cid)
    }
  }
  return { libraries, links, link_keys, pins }
}
