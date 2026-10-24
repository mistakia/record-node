// The identity library on this peer (§4.8): opening it with the identity,
// recording own libraries, links, and retirements in it, and bringing the
// open libraries in line with it whenever it changes, here or on another
// device of the identity.

import { randomInt } from 'node:crypto'

import { derive_library_address, IDENTITY_LIBRARY_NAME, validate_discriminator } from '#encoding/library-address.ts'
import { compute_log_id } from '#entry/id.ts'
import { build_identity_del, build_identity_put, canonical_cid } from '#entry/identity-record.ts'
import { is_identity_operation } from '#entry/operations.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { ProfileRecord } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import type { LibraryType } from '#types/library.ts'
import { PeerError, type MetaLogPage, type MetaLogRecord } from '#types/peer.ts'
import { require_identity, serialise_write, type PeerContext } from './context.ts'
import { describe_library } from './describe.ts'
import {
  find_own_library, identity_state, LABELS_LIBRARY_NAME, labels_library, link_set, linked_addresses, LISTENS_LIBRARY_NAME, listens_library,
  own_libraries
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

// Records the unlink in the identity library.
const unlink_address = async (context: PeerContext, address: string): Promise<void> => {
  await context.libraries.begin_unlink(address)
  if (link_set(context).some((link) => link.address === address)) {
    await append_identity_record(context, build_identity_del({ type: 'link', key: compute_log_id(address) }))
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

// §3.6.1: 26 characters drawn uniformly from the lowercase RFC 4648 base32
// alphabet, 130 bits, so a discriminator carries no meaning.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const DISCRIMINATOR_LENGTH = 26

const random_discriminator = (): string =>
  Array.from({ length: DISCRIMINATOR_LENGTH }, () => BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)]).join('')

// A discriminator not yet recorded for the type, active or retired (§3.6.1):
// the initial one when given and free, otherwise a random one.
const fresh_discriminator = (context: PeerContext, type: LibraryType, initial?: string): string => {
  const { key_pair } = require_identity(context)
  const recorded = identity_state(context).libraries
  const free = (discriminator: string) => !recorded.has(derive_library_address({ key: key_pair.public_key, type, discriminator }))
  if (initial !== undefined && free(initial)) return initial
  for (;;) {
    const discriminator = random_discriminator()
    if (free(discriminator)) return discriminator
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

// A new recordstore under a random discriminator, which the caller never
// chooses (§3.6.1).
export const create_own_library = async (context: PeerContext): Promise<string> =>
  await serialise_write(context, async () =>
    await create_recorded_library(context, { type: 'recordstore', discriminator: fresh_discriminator(context, 'recordstore') }))

// The identity's current profile (§4.8.2), if it has written one.
export const read_profile = (context: PeerContext): ProfileRecord | undefined => identity_state(context).profile

// Writes the whole profile (§4.8.2): a later PUT replaces it, so an absent
// field is cleared. The avatar is stored in canonical form. An unchanged
// profile appends nothing.
export const write_profile = async (context: PeerContext, fields: { name?: string | undefined, bio?: string | undefined, avatar?: string | undefined }): Promise<ProfileRecord | undefined> =>
  await serialise_write(context, async () => {
    try {
      const wanted = {
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.bio === undefined ? {} : { bio: fields.bio }),
        ...(fields.avatar === undefined ? {} : { avatar: canonical_cid(fields.avatar) })
      }
      const current = read_profile(context)
      const same = (field: 'name' | 'bio' | 'avatar') => current?.[field] === wanted[field]
      if (current !== undefined && same('name') && same('bio') && same('avatar')) return current
      await append_identity_record(context, build_identity_put({ type: 'profile', v: 1, timestamp: Date.now(), ...wanted }))
      return read_profile(context)
    } catch (error) {
      if (error instanceof ProtocolError && (error.code === 'invalid_shape' || error.code === 'invalid_cid')) throw new PeerError('invalid', error.message)
      throw error
    }
  })

// Retirement is permanent (§4.8.3). The active listens and labels libraries
// are never retired, since their records would have nowhere to go.
export const retire_own_library = async (context: PeerContext, address: string): Promise<void> => {
  await serialise_write(context, async () => {
    const own = find_own_library(context, address)
    if (own === undefined) throw new PeerError('not_found', `not an own library: ${address}`)
    if (own.retired) return
    if (address === listens_library(context) || address === labels_library(context)) {
      throw new PeerError('conflict', `the active ${own.type} library cannot be retired: ${address}`)
    }
    await append_identity_record(context, build_identity_del({ type: 'library', key: compute_log_id(address) }))
  })
}

// The listens and labels libraries, each created anew under a random
// discriminator should a non-conforming writer have retired it (§4.8.3).
// Run inside serialise_write.
export const ensure_listens_library = async (context: PeerContext): Promise<string> =>
  listens_library(context) ?? await create_recorded_library(context, { type: 'listens', discriminator: fresh_discriminator(context, 'listens', LISTENS_LIBRARY_NAME) })

export const ensure_labels_library = async (context: PeerContext): Promise<string> =>
  labels_library(context) ?? await create_recorded_library(context, { type: 'labels', discriminator: fresh_discriminator(context, 'labels', LABELS_LIBRARY_NAME) })

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

// Opens the identity library for a key and syncs. Every identity has a
// listens and a labels library (§4.8.3): one under its initial discriminator
// that the identity library does not record yet is created and recorded, so
// an identity from before the labels library gains one on open. A new
// identity also gets a first recordstore, under a random discriminator
// (§3.6.1); a reopened or imported one creates none, since its recordstores
// are in its identity library.
export const open_identity = async (context: PeerContext, key_pair: KeyPair, { created }: { created: boolean }): Promise<void> => {
  const write_keys = [key_pair.public_key]
  const identity = await context.libraries.create_library({ name: IDENTITY_LIBRARY_NAME, type: 'identity', write_keys })
  context.identity = { key_pair, identity_address: identity.chain.address }
  context.known = { ready: false, links: new Set(), libraries: new Map() }
  const recorded = identity_state(context).libraries
  for (const [name, type] of [[LISTENS_LIBRARY_NAME, 'listens'], [LABELS_LIBRARY_NAME, 'labels']] as const) {
    const address = derive_library_address({ key: key_pair.public_key, type, discriminator: name })
    if (recorded.has(address)) {
      // Opened here so the library counts as own before the sync below.
      await context.libraries.create_library({ name, type, write_keys })
    } else {
      await create_recorded_library(context, { type, discriminator: name })
    }
  }
  if (created) await create_recorded_library(context, { type: 'recordstore', discriminator: fresh_discriminator(context, 'recordstore') })
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
    is_current: is_identity_operation(operation) && entry.state_keys.some((slot) => oplog?.current.get(slot) === entry)
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
  // Filtered and sorted as entries, so only the page is built into records:
  // the app's head-check asks for one.
  const is_current = (entry: VerifiedEntry): boolean =>
    is_identity_operation(entry.operation) && entry.state_keys.some((slot) => oplog.current.get(slot) === entry)
  const entries = [...oplog.entries.values()]
    .filter((entry) => (type === undefined || String((entry.operation as { value: Record<string, unknown> }).value.type) === type) &&
      (!current_only || is_current(entry)))
    .sort((a, b) => b.entry.clock.time - a.entry.clock.time || (a.hash < b.hash ? -1 : 1))
  const items = entries.slice(offset, offset + limit).map((entry) => meta_log_record(context, entry))
  return { address, heads: [...oplog.heads].sort(), items, total: entries.length }
}
