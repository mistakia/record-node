// The identity library on this peer (§4.8): opening it with the identity,
// recording own libraries, links, and retirements in it, and bringing the
// open libraries in line with it whenever it changes, here or on another
// device of the identity.

import { randomBytes } from 'node:crypto'

import { derive_library_address, IDENTITY_LIBRARY_NAME, validate_discriminator } from '#encoding/library-address.ts'
import { compute_log_id } from '#entry/id.ts'
import { build_identity_del, build_identity_put } from '#entry/identity-record.ts'
import { build_del_operation, is_identity_operation } from '#entry/operations.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { ProtocolError } from '#types/errors.ts'
import type { LibraryType } from '#types/library.ts'
import { PeerError, type MetaLogPage, type MetaLogRecord } from '#types/peer.ts'
import { require_identity, serialise_write, type PeerContext } from './context.ts'
import { describe_library } from './describe.ts'
import {
  find_own_library, identity_state, link_set, linked_addresses, LISTENS_LIBRARY_NAME, listens_library, own_libraries, OWN_LIBRARY_NAME
} from './ownership.ts'

// A linked or claimed library opens once its AC chain is in the local store;
// until then it stays loading.
export const try_open_library = async (context: PeerContext, address: string): Promise<void> => {
  try {
    await context.libraries.open_library(address)
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error
  }
}

// With a network, replication opens the library, fetching its chain from
// peers when need be, and starts or resumes replicating it.
export const connect_address = async (context: PeerContext, address: string): Promise<void> => {
  if (context.replication === undefined) await try_open_library(context, address)
  else await context.replication.connect(address)
}

export const append_identity_record = async (context: PeerContext, payload: unknown): Promise<void> => {
  const { key_pair, identity_address } = require_identity(context)
  await context.libraries.append({ library_address: identity_address, payload, key_pair })
}

// §4.6 and §5.4.4, restartable: the marker is on disk before anything changes,
// the link records follow, and the manager releases what only this library
// held, clearing the marker last. Every step is idempotent.
const drop_replica = async (context: PeerContext, address: string): Promise<void> => {
  await context.replication?.unlink(address)
  await context.libraries.unlink_library(address)
}

// Records the unlink in the identity library, and with a Log DEL in each
// active own library a v1.0 Log entry links it from, so v1.0 peers see it.
const unlink_address = async (context: PeerContext, address: string): Promise<void> => {
  const { key_pair } = require_identity(context)
  await context.libraries.begin_unlink(address)
  if (link_set(context).some((link) => link.address === address)) {
    await append_identity_record(context, build_identity_del({ type: 'link', key: compute_log_id(address) }))
  }
  for (const own of own_libraries(context)) {
    const oplog = context.libraries.get(own.address)?.oplog
    if (own.retired || own.type !== 'recordstore' || oplog === undefined) continue
    if (get_live_entry({ oplog, key: compute_log_id(address) }) === undefined) continue
    await context.libraries.append({ library_address: own.address, payload: build_del_operation({ key: compute_log_id(address), type: 'log' }), key_pair })
  }
  await drop_replica(context, address)
}

// Finishes every unlink a crash cut short. The library is opened first, so its
// pin set is rebuilt from what it holds before the release runs again.
export const finish_pending_unlinks = async (context: PeerContext): Promise<void> => {
  for (const address of await context.libraries.pending_unlinks()) {
    await try_open_library(context, address)
    await unlink_address(context, address)
  }
}

export const link_address = async (context: PeerContext, { address, alias }: { address: string, alias: string | null }): Promise<void> => {
  await serialise_write(context, async () => {
    // A recorded library counts here even before its chain is fetched.
    if (address === require_identity(context).identity_address || identity_state(context).libraries.has(address)) {
      throw new PeerError('conflict', `a peer does not link its own library: ${address}`)
    }
    const timestamp = Date.now()
    await append_identity_record(context, build_identity_put(alias === null
      ? { type: 'link', v: 1, timestamp, address }
      : { type: 'link', v: 1, timestamp, address, alias }))
    await connect_address(context, address)
    context.known.links.add(address)
    // Linking gives the library a replication policy (§4.6.1).
    await context.blobs.policy_changed(address)
  })
}

export const unlink_library = async (context: PeerContext, address: string): Promise<void> => {
  await serialise_write(context, async () => {
    if (find_own_library(context, address) !== undefined) {
      throw new PeerError('conflict', `an own library is retired, not unlinked: ${address}`)
    }
    // Forgotten first, so the sync the link DEL queues never drops the
    // replica a second time; an unlink cut short is finished from its marker.
    context.known.links.delete(address)
    await unlink_address(context, address)
  })
}

// A discriminator not yet recorded for the type, active or retired (§3.6.1).
const fresh_discriminator = (context: PeerContext, type: LibraryType, prefix: string): string => {
  const { key_pair } = require_identity(context)
  const recorded = identity_state(context).libraries
  for (;;) {
    const discriminator = `${prefix}-${randomBytes(4).toString('hex')}`
    if (!recorded.has(derive_library_address({ key: key_pair.public_key, type, discriminator }))) return discriminator
  }
}

// Creates and records an own library (§3.6.1, §4.8.3). A discriminator the
// identity library records for the type is refused, since it names that
// library, which may be retired.
const create_recorded_library = async (context: PeerContext, { type, discriminator }: { type: LibraryType, discriminator: string }): Promise<string> => {
  const { key_pair } = require_identity(context)
  validate_discriminator(discriminator)
  const address = derive_library_address({ key: key_pair.public_key, type, discriminator })
  if (identity_state(context).libraries.has(address)) throw new PeerError('conflict', `the identity already records ${address}`)
  await context.libraries.create_library({ name: discriminator, type, write_keys: [key_pair.public_key] })
  await append_identity_record(context, build_identity_put({ type: 'library', v: 1, timestamp: Date.now(), address }))
  await context.replication?.connect(address)
  return address
}

export const create_own_library = async (context: PeerContext, { discriminator }: { discriminator?: string | undefined }): Promise<string> =>
  await serialise_write(context, async () => {
    const name = discriminator ?? fresh_discriminator(context, 'recordstore', 'library')
    return await create_recorded_library(context, { type: 'recordstore', discriminator: name })
  })

// Retirement is permanent (§4.8.3). The active listens library is never
// retired, since the identity's listens would have nowhere to go.
export const retire_own_library = async (context: PeerContext, address: string): Promise<void> => {
  await serialise_write(context, async () => {
    const own = find_own_library(context, address)
    if (own === undefined) throw new PeerError('not_found', `not an own library: ${address}`)
    if (own.retired) return
    if (address === listens_library(context)) throw new PeerError('conflict', `the active listens library cannot be retired: ${address}`)
    await append_identity_record(context, build_identity_del({ type: 'library', key: compute_log_id(address) }))
  })
}

// The listens library, created anew should a non-conforming writer have
// retired it (§4.8.3). Runs inside serialise_write.
export const ensure_listens_library = async (context: PeerContext): Promise<string> =>
  listens_library(context) ?? await create_recorded_library(context, { type: 'listens', discriminator: fresh_discriminator(context, 'listens', LISTENS_LIBRARY_NAME) })

// What the identity library says, applied to the open libraries: every
// recorded and linked library opens and replicates, a link removed on another
// device drops its replica, and own-library changes are announced as events.
// The first sync after opening the identity announces nothing.
export const sync_identity = async (context: PeerContext): Promise<void> => {
  for (const address of identity_state(context).libraries.keys()) {
    if (context.libraries.get(address) === undefined) await connect_address(context, address)
  }
  const links = new Set(linked_addresses(context))
  for (const address of links) {
    if (context.libraries.get(address) !== undefined && context.known.links.has(address)) continue
    await connect_address(context, address)
    await context.blobs.policy_changed(address)
  }
  const { known, events } = context
  for (const address of [...known.links]) {
    if (links.has(address) || find_own_library(context, address) !== undefined) continue
    await context.libraries.begin_unlink(address)
    await drop_replica(context, address)
    if (known.ready) events.emit({ type: 'library:unlinked', payload: { library_address: address } })
  }
  const own = own_libraries(context)
  if (known.ready) {
    for (const library of own) {
      const before = known.libraries.get(library.address)
      const described = describe_library(context, library.address)
      if (before === undefined && described !== undefined) events.emit({ type: 'identity:library-created', payload: { library: described } })
      if (library.retired && before !== true) events.emit({ type: 'identity:library-retired', payload: { library_address: library.address } })
    }
  }
  known.links = links
  known.libraries = new Map(own.map(({ address, retired }) => [address, retired]))
  known.ready = true
  await context.blobs.sync_pins(identity_state(context).pins)
}

// Queued behind the write in progress: an identity-library change found by a
// merge or an append never waits on the write that made it.
export const queue_identity_sync = (context: PeerContext): void => {
  if (context.stopping || context.identity === undefined) return
  serialise_write(context, async () => { await sync_identity(context) })
    .catch((error: unknown) => { process.emitWarning(`identity library sync failed: ${(error as Error).message}`) })
}

// Opens the identity library for a key, records the own libraries record-node
// v1.0 created for every identity (§4.8.3), and syncs. A new identity gets
// both: a recordstore to write to and a listens library.
export const open_identity = async (context: PeerContext, key_pair: KeyPair): Promise<void> => {
  const write_keys = [key_pair.public_key]
  const identity = await context.libraries.create_library({ name: IDENTITY_LIBRARY_NAME, type: 'identity', write_keys })
  context.identity = { key_pair, identity_address: identity.chain.address }
  context.known = { ready: false, links: new Set(), libraries: new Map() }
  const recorded = identity_state(context).libraries
  for (const [name, type] of [[OWN_LIBRARY_NAME, 'recordstore'], [LISTENS_LIBRARY_NAME, 'listens']] as const) {
    const { chain } = await context.libraries.create_library({ name, type, write_keys })
    if (!recorded.has(chain.address)) {
      await append_identity_record(context, build_identity_put({ type: 'library', v: 1, timestamp: Date.now(), address: chain.address }))
    }
  }
  await context.libraries.settled()
  await sync_identity(context)
}

export const meta_log_record = (context: PeerContext, entry: VerifiedEntry): MetaLogRecord => {
  const { operation } = entry
  const { op, key, value } = operation as { op: 'PUT' | 'DEL', key: string, value: Record<string, unknown> }
  const oplog = context.libraries.get(require_identity(context).identity_address)?.oplog
  return {
    entry_hash: entry.hash,
    op,
    type: String(value.type),
    key,
    record: value,
    clock_time: entry.entry.clock.time,
    timestamp_ms: typeof value.timestamp === 'number' ? value.timestamp : 0,
    is_current: is_identity_operation(operation) && entry.state_key !== undefined && oplog?.current.get(entry.state_key) === entry
  }
}

// Newest first by clock time, then hash.
export const read_meta_log = (context: PeerContext, { offset, limit, type, current_only }: {
  offset: number
  limit: number
  type?: string | undefined
  current_only: boolean
}): MetaLogPage => {
  const address = require_identity(context).identity_address
  const oplog = context.libraries.get(address)?.oplog
  if (oplog === undefined) throw new Error('the identity library is not open')
  const records = [...oplog.entries.values()]
    .map((entry) => meta_log_record(context, entry))
    .filter((record) => (type === undefined || record.type === type) && (!current_only || record.is_current))
    .sort((a, b) => b.clock_time - a.clock_time || (a.entry_hash < b.entry_hash ? -1 : 1))
  return { address, heads: [...oplog.heads].sort(), items: records.slice(offset, offset + limit), total: records.length }
}
