// Library lifecycle (§3.5.1, §4.6): create, open, close, and unlink, plus the
// write path every entry takes on its way into an open library. The manager
// holds the per-library pin sets, so unlink can release exactly what no other
// library still holds; the store's pins themselves do not count references.

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain, type ResolvedAcChain } from '#access-control/resolve.ts'
import { is_operation } from '#entry/operations.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { append_entry, create_oplog, type Oplog } from '#oplog/dag.ts'
import { merge_entries, type MergeResult } from '#oplog/merge.ts'
import type { Projector } from '#query-db/projector.ts'
import type { LibraryType } from '#types/library.ts'
import { PeerError } from '#types/peer.ts'
import { load_entry_blocks } from './load.ts'
import { chain_pins, entry_pins, pin_into, type PinSet } from './pins.ts'
import type { LibraryStateStore } from './state.ts'

export interface LibraryHandle {
  readonly chain: ResolvedAcChain
  readonly oplog: Oplog
  readonly pins: PinSet
}

export interface LibraryManager {
  create_library: (input: { name: string, type: LibraryType, write_keys: readonly string[] }) => Promise<LibraryHandle>
  open_library: (library_address: string) => Promise<LibraryHandle>
  // An unlink runs in two calls: begin_unlink persists the marker, then
  // unlink_library releases what the library held, its heads, and its index
  // rows, and clears the marker last. A crash in between leaves the marker,
  // and pending_unlinks names it at the next start.
  begin_unlink: (library_address: string) => Promise<void>
  unlink_library: (library_address: string) => Promise<void>
  pending_unlinks: () => Promise<string[]>
  get: (library_address: string) => LibraryHandle | undefined
  list: () => LibraryHandle[]
  // Signs, stores, pins, and indexes one local entry.
  append: (input: { library_address: string, payload: unknown, key_pair: KeyPair }) => Promise<VerifiedEntry>
  // Stores, pins, and indexes entries already in the oplog (an ingest PUT).
  register: (input: { library_address: string, entries: readonly VerifiedEntry[] }) => Promise<void>
  // Remote entry blocks (§4.5), as replication fetched them.
  merge: (input: { library_address: string, blocks: readonly Uint8Array[] }) => Promise<MergeResult>
  // Pins and re-indexes entries whose content payload reached the store
  // after the entry itself.
  reindex: (input: { library_address: string, entries: readonly VerifiedEntry[] }) => Promise<void>
  // Waits for queued index writes.
  settled: () => Promise<void>
}

export const create_library_manager = ({ content_store, projector, state_store, on_entries }: {
  content_store: ContentStore
  projector: Projector
  state_store: LibraryStateStore
  // After entries are indexed.
  on_entries?: (input: { library_address: string, entries: readonly VerifiedEntry[] }) => void
}): LibraryManager => {
  const libraries = new Map<string, LibraryHandle>()
  let indexing: Promise<unknown> = Promise.resolve()

  const require_library = (library_address: string): LibraryHandle => {
    const handle = libraries.get(library_address)
    if (handle === undefined) throw new PeerError('not_found', `library not open: ${library_address}`)
    return handle
  }

  const pin_entries = async (handle: LibraryHandle, entries: Iterable<VerifiedEntry>) => {
    for (const entry of entries) {
      await pin_into({ content_store, pins: handle.pins, items: await entry_pins({ content_store, entry }) })
    }
  }

  const register = async ({ library_address, entries }: { library_address: string, entries: readonly VerifiedEntry[] }) => {
    const handle = require_library(library_address)
    for (const entry of entries) await content_store.put(entry.hash, entry.bytes)
    await pin_entries(handle, entries)
    await state_store.save_heads({ library_address, heads: [...handle.oplog.heads] })
    const projected = Promise.all(entries.map(async (entry) => { await projector.project_append({ oplog: handle.oplog, entry }) }))
    indexing = projected.catch(() => {})
    await projected
    on_entries?.({ library_address, entries })
  }

  // Resolving the chain is the gate (§3.5.1): a library that fails it never
  // gets an oplog. Its objects are pinned before any entry is loaded.
  const open_library = async (library_address: string): Promise<LibraryHandle> => {
    const existing = libraries.get(library_address)
    if (existing !== undefined) return existing
    const chain = await resolve_ac_chain({ library_address, block_store: content_store })
    const handle: LibraryHandle = { chain, oplog: create_oplog({ chain }), pins: new Map() }
    await pin_into({ content_store, pins: handle.pins, items: chain_pins(chain) })
    const heads = (await state_store.load()).heads.get(library_address) ?? []
    merge_entries({ oplog: handle.oplog, blocks: await load_entry_blocks({ heads, content_store }) })
    await pin_entries(handle, handle.oplog.entries.values())
    libraries.set(library_address, handle)
    const actual_heads = [...handle.oplog.heads].sort()
    await state_store.save_heads({ library_address, heads: actual_heads })
    // The persisted index covers the loaded oplog exactly when its marker names
    // the same heads; then the full replay is skipped and only the keys whose
    // content was missing at the last write are re-projected, so a payload
    // that arrived while the peer was down still fills in. Anything else — a
    // library not in the index, a schema change, or heads that no longer
    // reproduce after load — clears the library's rows and projects them over.
    const marker = await projector.projection_state({ library_address })
    if (marker !== undefined && JSON.stringify(marker.heads) === JSON.stringify(actual_heads)) {
      if (marker.pending.length > 0) await projector.project_keys({ oplog: handle.oplog, keys: marker.pending })
    } else {
      await projector.remove_library({ library_address })
      await projector.project_library({ oplog: handle.oplog })
    }
    return handle
  }

  return {
    create_library: async ({ name, type, write_keys }) => {
      const { address } = await create_ac_chain({ name, type, write_keys, block_store: content_store })
      return await open_library(address)
    },
    open_library,
    begin_unlink: async (library_address) => {
      await state_store.set_unlinking({ library_address, unlinking: true })
    },
    // §4.6: release the chain, the entries, and the content this library held
    // unless another library still holds the same CID. Every step is
    // idempotent, so a finish after a crash repeats it safely. A library that
    // was never opened holds no pins.
    unlink_library: async (library_address) => {
      const handle = libraries.get(library_address)
      libraries.delete(library_address)
      const held_elsewhere = new Set([...libraries.values()].flatMap(({ pins }) => [...pins.keys()]))
      for (const cid of handle?.pins.keys() ?? []) {
        if (!held_elsewhere.has(cid)) await content_store.unpin(cid)
      }
      handle?.pins.clear()
      await state_store.save_heads({ library_address, heads: undefined })
      await projector.remove_library({ library_address })
      await state_store.set_unlinking({ library_address, unlinking: false })
    },
    pending_unlinks: async () => [...(await state_store.load()).unlinking],
    get: (library_address) => libraries.get(library_address),
    list: () => [...libraries.values()],
    append: async ({ library_address, payload, key_pair }) => {
      const { oplog } = require_library(library_address)
      const entry = append_entry({ oplog, payload, key_pair })
      await register({ library_address, entries: [entry] })
      return entry
    },
    register,
    merge: async ({ library_address, blocks }) => {
      const { oplog } = require_library(library_address)
      const result = merge_entries({ oplog, blocks })
      if (result.merged.length > 0) await register({ library_address, entries: result.merged })
      return result
    },
    reindex: async ({ library_address, entries }) => {
      const handle = require_library(library_address)
      await pin_entries(handle, entries)
      const keys = entries.flatMap(({ operation }) => is_operation(operation) ? [operation.key] : [])
      const projected = projector.project_keys({ oplog: handle.oplog, keys })
      indexing = projected.catch(() => {})
      await projected
      on_entries?.({ library_address, entries })
    },
    settled: async () => { await indexing }
  }
}
