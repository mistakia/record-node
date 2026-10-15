// Library lifecycle (§3.5.1, §4.6): create, open, close, and unlink, plus the
// write path every entry takes on its way into an open library. The manager
// holds the per-library pin sets, so unlink can release exactly what no other
// library still holds; the store's pins themselves do not count references.

import { setImmediate as next_turn } from 'node:timers/promises'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain, type ResolvedAcChain } from '#access-control/resolve.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { LibraryPinRecord } from '#fabric/pin-index.ts'
import { is_put } from '#entry/operations.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { append_entry_with_access, create_oplog, type AccessChange, type Oplog } from '#oplog/dag.ts'
import { merge_entries, restore_entries, type MergeResult } from '#oplog/merge.ts'
import type { EntryBlockCache } from '#query-db/entry-blocks.ts'
import type { Projector } from '#query-db/projector.ts'
import type { LibraryType } from '#types/library.ts'
import { PeerError } from '#types/peer.ts'
import { run_bounded } from './bounded.ts'
import { load_entry_blocks } from './load.ts'
import { open_phases, type OpenPhases } from './open-phases.ts'
import { canonical_cid } from '#entry/identity-record.ts'
import { chain_pins, entry_pins, pin_into, stored_item_6, type KeepsBlobs, type PinSet } from './pins.ts'
import type { LibraryStateStore, StoredPolicy } from './state.ts'

// One append_many build: its entry, none when it built no payload, or why it failed.
export type AppendOutcome = { ok: true, entry: VerifiedEntry | undefined } | { ok: false, error: unknown }

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
  // Node-local replication policies (§4.6.1), kept with the heads.
  load_policies: () => Promise<ReadonlyMap<string, StoredPolicy>>
  save_policy: (input: { library_address: string, policy: StoredPolicy | undefined }) => Promise<void>
  get: (library_address: string) => LibraryHandle | undefined
  list: () => LibraryHandle[]
  // Signs, stores, pins, and indexes one local entry.
  append: (input: { library_address: string, payload: unknown, key_pair: KeyPair }) => Promise<VerifiedEntry>
  // Signs and appends local entries one at a time, yielding between them, and
  // indexes them as one batch: one heads write, one projection, one
  // on_entries. Each build runs just before its append, against the oplog the
  // earlier ones left, and returns the payload or undefined to append
  // nothing; a build or append that throws fails alone.
  append_many: (input: { library_address: string, builds: ReadonlyArray<() => unknown>, key_pair: KeyPair }) => Promise<AppendOutcome[]>
  // Stores, pins, and indexes entries already in the oplog (an ingest PUT),
  // and re-indexes the keys a revocation among them moved.
  register: (input: { library_address: string, entries: readonly VerifiedEntry[], access?: AccessChange }) => Promise<void>
  // Remote entry blocks (§4.5), as replication fetched them.
  merge: (input: { library_address: string, blocks: readonly Uint8Array[] }) => Promise<MergeResult>
  // Pins and re-indexes entries whose content payload reached the store
  // after the entry itself.
  reindex: (input: { library_address: string, entries: readonly VerifiedEntry[] }) => Promise<void>
  // Item 6 blobs the library's policy now keeps, once their blocks are local
  // (§4.6.1); and ones it no longer keeps, unpinned unless held elsewhere.
  hold_blobs: (input: { library_address: string, cids: readonly string[] }) => Promise<void>
  release_blobs: (input: { library_address: string, cids: readonly string[] }) => Promise<void>
  // Unpins blobs an ingest pinned but never committed, unless a library or a
  // pin record holds them.
  release_unheld: (cids: readonly string[]) => Promise<void>
  // Waits for queued index writes.
  settled: () => Promise<void>
  // Waits for queued pin work: the re-pin passes opens queued, and item 6
  // holds and releases. Every library's pin set is complete afterwards.
  pins_settled: () => Promise<void>
  // For stop: cuts re-pin passes short, since each is a repair the next open
  // redoes, and refuses releases from then on, since a pin set a cut pass left
  // incomplete could release a blob another library holds.
  stop_pin_passes: () => void
}

// Pins compare by CID, whatever the encoding: an entry's base58btc
// content.hash and a pin record's base32 CIDv1 name one blob.
const canonical_or_self = (cid: string): string => {
  try {
    return canonical_cid(cid)
  } catch {
    return cid
  }
}

// Entries pinned at once. Each pin is a few small reads, which a slow disk
// serves far faster side by side than one after another.
const PIN_CONCURRENCY = 16

const same_heads = (a: Iterable<string>, b: Iterable<string>): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

export const create_library_manager = ({ content_store, projector, entry_blocks, state_store, pin_record, on_entries, keeps_blobs = () => () => true, retained = () => new Set(), hold_commits = async (job) => await job() }: {
  content_store: ContentStore
  projector: Projector
  entry_blocks: EntryBlockCache
  state_store: LibraryStateStore
  // Each library's pin set as last held, so an open whose recorded set is
  // clean takes it back instead of re-pinning every entry. Without one,
  // every open re-pins in full.
  pin_record?: LibraryPinRecord | undefined
  // Whether a library's policy keeps an entry's item 6 (§4.6.1), judged from
  // its resolved chain, since it runs before the library is listed; every
  // library keeps them by default.
  keeps_blobs?: (chain: ResolvedAcChain) => KeepsBlobs
  // Canonical CIDs the identity library pins (§4.6.2): never released here.
  retained?: () => ReadonlySet<string>
  // Holds the index and pin stores' commits while job runs, so a batch's
  // pins, entry blocks and projection commit once (CommitBatcher.hold).
  hold_commits?: <T>(job: () => Promise<T>) => Promise<T>
  // After entries are indexed, with the entries a revocation among them made
  // inert; batched for an append_many batch, which reports as one change.
  on_entries?: (input: { library_address: string, entries: readonly VerifiedEntry[], inert: readonly VerifiedEntry[], batched?: boolean }) => void
}): LibraryManager => {
  const libraries = new Map<string, LibraryHandle>()
  let indexing: Promise<unknown> = Promise.resolve()

  // Item 6 holds and releases apply one at a time, so a release made after a
  // hold always undoes it, whichever await each was in. An open's re-pin pass
  // queues here too, so no release decides on a pin set it has not filled.
  let pin_tail: Promise<unknown> = Promise.resolve()
  const exclusive_pins = async <T>(job: () => Promise<T>): Promise<T> => {
    const run = pin_tail.then(job)
    pin_tail = run.catch(() => {})
    return await run
  }

  const require_library = (library_address: string): LibraryHandle => {
    const handle = libraries.get(library_address)
    if (handle === undefined) throw new PeerError('not_found', `library not open: ${library_address}`)
    return handle
  }

  let pin_passes_stopped = false

  // Per open library: the pin set changes in flight, and whether a pass has
  // filled the set since the open.
  const pin_states = new Map<string, { changing: number, complete: boolean }>()

  // Every change to a library's pin set runs here, so its record is dirty
  // while any change is in flight, and clean again once none is and the
  // set is complete.
  const changing_pins = async <T>(handle: LibraryHandle, job: () => Promise<T>): Promise<T> => {
    const library_address = handle.chain.address
    const state = pin_states.get(library_address)
    if (pin_record === undefined || state === undefined) return await job()
    if (state.changing++ === 0) pin_record.begin(library_address)
    try {
      return await job()
    } finally {
      state.changing -= 1
      if (state.changing === 0 && state.complete && libraries.get(library_address) === handle) pin_record.settle(library_address)
    }
  }

  const record_pins = (handle: LibraryHandle, added: ReadonlyArray<readonly [string, boolean]>) => {
    if (added.length > 0) pin_record?.set(handle.chain.address, added)
  }

  const pin_entries = async (handle: LibraryHandle, entries: Iterable<VerifiedEntry>, { pass = false } = {}) => {
    const keeps = keeps_blobs(handle.chain)
    await run_bounded(entries, PIN_CONCURRENCY, async (entry) => {
      if (pass && pin_passes_stopped) return
      record_pins(handle, await pin_into({ content_store, pins: handle.pins, items: await entry_pins({ content_store, library_address: handle.chain.address, entry, keeps_blobs: keeps }) }))
    })
  }

  // The canonical CIDs some other library or a pin record still holds.
  const held_elsewhere = (library_address: string): Set<string> => {
    const held = new Set(retained())
    for (const { chain, pins } of libraries.values()) {
      if (chain.address === library_address) continue
      for (const cid of pins.keys()) held.add(canonical_or_self(cid))
    }
    return held
  }

  const release = async (handle: LibraryHandle | undefined, library_address: string, cids: Iterable<string>) => {
    if (pin_passes_stopped) throw new Error('the peer is stopping: blobs are not released')
    const held = held_elsewhere(library_address)
    for (const cid of cids) {
      if (!held.has(canonical_or_self(cid))) await content_store.unpin(cid)
      if (handle?.pins.delete(cid) === true) pin_record?.delete(library_address, [cid])
    }
  }

  // Pins, persists heads for, and indexes entries whose blocks are stored.
  const index_stored = async ({ library_address, entries, access, batched = false }: {
    library_address: string
    entries: readonly VerifiedEntry[]
    access?: AccessChange | undefined
    batched?: boolean
  }) => {
    const handle = require_library(library_address)
    entry_blocks.save({ library_address, entries, heads: handle.oplog.heads })
    await changing_pins(handle, async () => { await pin_entries(handle, entries) })
    await state_store.save_heads({ library_address, heads: [...handle.oplog.heads] })
    const projected = projector.project_entries({ oplog: handle.oplog, entries, keys: access?.keys ?? [] })
    indexing = projected.catch(() => {})
    await projected
    on_entries?.({ library_address, entries, inert: access?.inert ?? [], ...(batched ? { batched } : {}) })
  }

  const register = async ({ library_address, entries, access }: {
    library_address: string
    entries: readonly VerifiedEntry[]
    access?: AccessChange
  }) => {
    require_library(library_address)
    for (const entry of entries) await content_store.put(entry.hash, entry.bytes)
    await index_stored({ library_address, entries, access })
  }

  // Each block is stored before the next turn, since any register in that
  // turn persists heads that already name it.
  const append_many = async ({ library_address, builds, key_pair }: {
    library_address: string
    builds: ReadonlyArray<() => unknown>
    key_pair: KeyPair
  }): Promise<AppendOutcome[]> => {
    const { oplog } = require_library(library_address)
    const outcomes: AppendOutcome[] = []
    const entries: VerifiedEntry[] = []
    const inert: VerifiedEntry[] = []
    const keys = new Set<string>()
    for (const build of builds) {
      let appended
      try {
        const payload = build()
        appended = payload === undefined ? undefined : append_entry_with_access({ oplog, payload, key_pair })
      } catch (error) {
        outcomes.push({ ok: false, error })
        await next_turn()
        continue
      }
      outcomes.push({ ok: true, entry: appended?.entry })
      if (appended !== undefined) {
        const { entry, access } = appended
        entries.push(entry)
        inert.push(...access.inert)
        for (const key of access.keys) keys.add(key)
        // A store failure is the batch's, not the item's.
        await content_store.put(entry.hash, entry.bytes)
      }
      await next_turn()
    }
    if (entries.length > 0) await hold_commits(async () => { await index_stored({ library_address, entries, access: { inert, keys }, batched: true }) })
    return outcomes
  }

  // The oplog at the persisted heads, from the entry block cache when it
  // reproduces them. A cache last written at those heads under the current
  // verification rules is restored without verifying each entry again; any
  // other cache is verified in full and, if it holds, marked verified.
  // Otherwise, as for a library cached before or whose cache fell behind a
  // crash, the oplog is walked from the blockstore, verified, and recached.
  const load_oplog = async (chain: ResolvedAcChain, heads: readonly string[], phases: OpenPhases) => {
    const library_address = chain.address
    const { blocks, verified_heads } = phases.time('read_cache', () => entry_blocks.load(library_address))
    const trusted = verified_heads !== undefined && same_heads(verified_heads, heads)
    const cached = create_oplog({ chain })
    const from_cache = phases.time(trusted ? 'restore' : 'verify_cache', () => (trusted ? restore_entries : merge_entries)({ oplog: cached, blocks }))
    if (from_cache.rejected.length === 0 && same_heads(cached.heads, heads)) {
      if (!trusted) entry_blocks.mark_verified({ library_address, heads: cached.heads })
      return { oplog: cached, loaded: from_cache }
    }
    const oplog = create_oplog({ chain })
    const walked = await phases.time_async('walk_blocks', async () => await load_entry_blocks({ heads, content_store }))
    const loaded = phases.time('verify_walk', () => merge_entries({ oplog, blocks: walked }))
    phases.time('write_cache', () => { entry_blocks.replace({ library_address, entries: oplog.entries.values(), heads: oplog.heads }) })
    return { oplog, loaded }
  }

  // Resolving the chain is the gate (§3.5.1): a library that fails it never
  // gets an oplog. Its objects are pinned before any entry is loaded.
  const open_library = async (library_address: string): Promise<LibraryHandle> => {
    const existing = libraries.get(library_address)
    if (existing !== undefined) return existing
    const phases = open_phases()
    const chain = await phases.time_async('resolve_chain', async () => await resolve_ac_chain({ library_address, block_store: content_store }))
    const pins: PinSet = new Map()
    const chain_held = await pin_into({ content_store, pins, items: chain_pins(chain) })
    const heads = (await state_store.load()).heads.get(library_address) ?? []
    const { oplog, loaded } = await load_oplog(chain, heads, phases)
    const handle: LibraryHandle = { chain, oplog, pins }
    // A stored entry that no longer verifies, under a rule a later version
    // added, drops out of the oplog; that is never silent.
    const [first] = loaded.rejected
    if (first !== undefined) {
      process.emitWarning(`library ${library_address}: ${loaded.rejected.length} stored entries failed verification at open and were left out; first ${first.hash}: ${first.error.code} ${first.error.message}`)
    }
    libraries.set(library_address, handle)
    pin_states.set(library_address, { changing: 0, complete: false })
    const actual_heads = [...handle.oplog.heads].sort()
    await state_store.save_heads({ library_address, heads: actual_heads })
    // The persisted index covers the loaded oplog exactly when its marker names
    // the same heads; then the full replay is skipped and only the keys whose
    // content was missing at the last write are re-projected, so a payload
    // that arrived while the peer was down still fills in. Anything else — a
    // library not in the index, a schema change, or heads that no longer
    // reproduce after load — clears the library's rows and projects them over.
    const marker = await projector.projection_state({ library_address })
    await phases.time_async('project', async () => {
      if (marker !== undefined && JSON.stringify(marker.heads) === JSON.stringify(actual_heads)) {
        if (marker.pending.length > 0) await projector.project_keys({ oplog: handle.oplog, keys: marker.pending })
      } else {
        await projector.remove_library({ library_address })
        await projector.project_library({ oplog: handle.oplog })
      }
    })
    // A clean recorded pin set is the set as the last run left it, so only
    // entries it does not cover are pinned again: ones whose block or content
    // payload it lacks, as after a crash between an entry's heads and its
    // pins. Any other set is dropped and refilled by pinning every entry.
    const recorded = phases.time('load_pins', () => pin_record?.load(library_address))
    if (recorded === undefined) pin_record?.clear(library_address)
    else for (const [cid, recursive] of recorded) if (pins.get(cid) !== true) pins.set(cid, recursive)
    const unpinned = recorded === undefined
      ? [...handle.oplog.entries.values()]
      : [...handle.oplog.entries.values()].filter((entry) => !recorded.has(entry.hash) || (is_put(entry.operation) && !recorded.has(entry.operation.value.content)))
    const unrecorded = recorded === undefined ? chain_held : chain_held.filter(([cid, recursive]) => recorded.get(cid) !== recursive)
    phases.report(`library ${library_address} opened with ${handle.oplog.entries.size} entries`)
    // Re-pinning an entry repairs its pins and fills the pin set, at a few
    // small reads per entry: minutes for every entry of a large library on a
    // slow disk. So it runs after the open returns, queued with the holds and
    // releases.
    exclusive_pins(async () => {
      const state = pin_states.get(library_address)
      if (unpinned.length === 0 && unrecorded.length === 0) {
        if (state !== undefined) state.complete = true
        return
      }
      const pass = open_phases()
      await changing_pins(handle, async () => {
        record_pins(handle, unrecorded)
        await pass.time_async('repin', async () => { await pin_entries(handle, unpinned, { pass: true }) })
        if (!pin_passes_stopped && state !== undefined) state.complete = true
      })
      pass.report(`library ${library_address} re-pinned ${unpinned.length} of ${handle.oplog.entries.size} entries`)
    }).catch((error: unknown) => {
      process.emitWarning(`library ${library_address}: re-pinning its entries at open failed: ${(error as Error).message}`)
    })
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
      pin_states.delete(library_address)
      pin_record?.clear(library_address)
      // Every item 6 blob its entries reference, kept by the policy now or
      // before, since a pin outlives a policy change made while the peer was
      // down.
      const blobs: string[] = []
      for (const entry of handle?.oplog.entries.values() ?? []) {
        const item = await stored_item_6({ content_store, library_address, entry })
        if (item !== undefined) blobs.push(...item.blobs)
      }
      await exclusive_pins(async () => { await release(handle, library_address, new Set([...handle?.pins.keys() ?? [], ...blobs])) })
      await state_store.save_heads({ library_address, heads: undefined })
      await projector.remove_library({ library_address })
      entry_blocks.remove(library_address)
      await state_store.set_unlinking({ library_address, unlinking: false })
    },
    pending_unlinks: async () => [...(await state_store.load()).unlinking],
    load_policies: async () => (await state_store.load()).policies,
    save_policy: async (input) => { await state_store.save_policy(input) },
    get: (library_address) => libraries.get(library_address),
    list: () => [...libraries.values()],
    append: async ({ library_address, payload, key_pair }) => {
      const { oplog } = require_library(library_address)
      const { entry, access } = append_entry_with_access({ oplog, payload, key_pair })
      await register({ library_address, entries: [entry], access })
      return entry
    },
    append_many,
    register,
    merge: async ({ library_address, blocks }) => {
      const { oplog } = require_library(library_address)
      const result = merge_entries({ oplog, blocks })
      if (result.merged.length > 0) await register({ library_address, entries: result.merged, access: result.access })
      return result
    },
    reindex: async ({ library_address, entries }) => {
      const handle = require_library(library_address)
      await changing_pins(handle, async () => { await pin_entries(handle, entries) })
      const keys = entries.flatMap(({ state_key }) => state_key === undefined ? [] : [state_key])
      const projected = projector.project_keys({ oplog: handle.oplog, keys })
      indexing = projected.catch(() => {})
      await projected
      on_entries?.({ library_address, entries, inert: [] })
    },
    hold_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
      const handle = libraries.get(library_address)
      if (handle !== undefined) {
        await changing_pins(handle, async () => {
          record_pins(handle, await pin_into({ content_store, pins: handle.pins, items: cids.map((cid): [string, boolean] => [cid, true]) }))
        })
      }
    }),
    release_unheld: async (cids) => await exclusive_pins(async () => { await release(undefined, '', cids) }),
    release_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
      const handle = libraries.get(library_address)
      if (handle !== undefined) await changing_pins(handle, async () => { await release(handle, library_address, cids.filter((cid) => handle.pins.get(cid) === true)) })
    }),
    settled: async () => { await indexing },
    pins_settled: async () => { await exclusive_pins(async () => {}) },
    stop_pin_passes: () => { pin_passes_stopped = true }
  }
}
