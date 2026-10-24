// ApiPeer library, identity, capability, About, and listen methods.

import { parse_library_address } from '#encoding/library-address.ts'
import { build_about_put } from '#entry/operations.ts'
import { get_about, get_listen_count, list_listens } from '#query-db/queries.ts'
import type { ProfileRecord } from '#types/entry.ts'
import { PeerError, type About, type ApiPeer, type Library, type Profile } from '#types/peer.ts'
import { held_capabilities, held_capability_ids, issue_capability, list_capabilities, revoke_capability } from './capabilities.ts'
import { require_identity, serialise_write, type PeerContext } from './context.ts'
import { describe_library } from './describe.ts'
import {
  connect_address, create_own_library, ensure_listens_library, link_address, read_meta_log, read_profile, retire_own_library, unlink_library, write_profile
} from './identity-library.ts'
import { record_listen } from './listens.ts'
import { default_label_libraries, default_own_library, find_own_library, identity_state, library_scope, own_libraries, own_recordstore_addresses } from './ownership.ts'
import { effective_policy, get_replication_policy, validate_policy } from './policy.ts'
import { to_api_about, to_api_track } from './views.ts'
import { append_write, resolve_write_target } from './write-target.ts'

const require_library = (context: PeerContext, address: string): Library => {
  const library = describe_library(context, address)
  if (library === undefined) throw new PeerError('not_found', `unknown library: ${address}`)
  return library
}

// The libraries GET /libraries lists: own ones, the link set, and any the
// identity holds a capability in. The identity library is never listed.
const list_known = (context: PeerContext): Library[] => {
  const scope = library_scope(context)
  const addresses = new Set([...scope.own.keys(), ...scope.links.keys()])
  for (const { chain } of context.libraries.list()) {
    if (chain.type === 'recordstore' && !addresses.has(chain.address) && held_capability_ids(context, chain.address).length > 0) addresses.add(chain.address)
  }
  return [...addresses].flatMap((address) => describe_library(context, address, scope) ?? [])
}

// Writes an About record naming the library, owned or under a capability
// granting library.update_about (§2.6, §3.5.6); an unchanged name appends
// nothing.
const write_about = async (context: PeerContext, { address, name, capability_id }: {
  address: string
  name: string
  capability_id?: string | undefined
}): Promise<void> => {
  await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address: address, capability_id, kind: 'about' })
    if (name === get_about({ db: context.db, library_address: address })?.name) return
    await append_write(context, target, build_about_put({ name, capability_id: target.capability_id }))
  })
}

// A profile record as the API Profile: an absent field is null.
export const to_api_profile = (public_key: string, record: ProfileRecord | undefined): Profile => ({
  public_key, name: record?.name ?? null, bio: record?.bio ?? null, avatar: record?.avatar ?? null
})

// The owner profile of another library: the latest one a verified
// announcement carried for the single key of its write list (§5.3.2).
const announced_profile = (context: PeerContext, address: string): Profile | undefined => {
  const owner = context.announced.owners.get(address)
  const profile = owner === undefined ? undefined : context.announced.profiles.get(owner)
  return profile === undefined ? undefined : to_api_profile(profile.hashed.entry.key, profile.record)
}

const read_about = (context: PeerContext, address: string): About => {
  const about = get_about({ db: context.db, library_address: address })
  if (about === undefined) throw new Error(`the About entry of ${address} did not index`)
  return to_api_about(about)
}

const listens_addresses = (context: PeerContext): string[] =>
  own_libraries(context).filter(({ type }) => type === 'listens').map(({ address }) => address)

export const create_library_methods = (context: PeerContext): Pick<ApiPeer,
  'list_libraries' | 'get_library' | 'link_library' | 'unlink_library' | 'connect_library' | 'disconnect_library' |
  'get_replication_policy' | 'set_replication_policy' | 'list_capabilities' | 'issue_capability' | 'revoke_capability' |
  'get_about' | 'set_about' | 'get_library_profile' | 'list_listens' | 'record_listen' | 'get_identity' | 'get_profile' | 'set_profile' |
  'list_own_libraries' | 'create_own_library' |
  'retire_own_library' | 'list_held_capabilities' | 'read_meta_log'> => ({
  list_libraries: async () => list_known(context),

  get_library: async (address) => describe_library(context, address),

  // A link is a record in the identity library (§4.8.4).
  link_library: async ({ address, alias }) => {
    parse_library_address(address)
    await link_address(context, { address, alias })
    const about = get_about({ db: context.db, library_address: address })
    context.events.emit({ type: 'library:linked', payload: { library_address: address, ...(about === undefined ? {} : { about: to_api_about(about) }) } })
    return require_library(context, address)
  },

  unlink_library: async (address) => {
    await unlink_library(context, address)
    context.events.emit({ type: 'library:unlinked', payload: { library_address: address } })
  },

  // Connect starts or resumes replication; disconnect pauses it and leaves
  // the oplog open (§5.4.4). Content fetches follow (§4.6.1).
  connect_library: async (address) => {
    await serialise_write(context, async () => { await connect_address(context, address) })
    context.blobs.retry()
    context.events.emit({ type: 'library:connected', payload: { library_address: address } })
  },
  disconnect_library: async (address) => {
    await serialise_write(context, async () => { context.replication?.pause(address) })
    context.events.emit({ type: 'library:disconnected', payload: { library_address: address } })
  },

  get_replication_policy: async (address) => get_replication_policy(context, address),

  // Node-local: stored in the data directory, never written to a log (§4.6.1).
  set_replication_policy: async ({ address, mode, filter }) => {
    await serialise_write(context, async () => {
      if (find_own_library(context, address) !== undefined) throw new PeerError('conflict', `an own library is always replicated in full: ${address}`)
      if (effective_policy(context, address) === undefined) throw new PeerError('not_found', `not a linked library: ${address}`)
      const policy = validate_policy({ mode, filter })
      await context.libraries.save_policy({ library_address: address, policy })
      context.policies.set(address, policy)
      await context.blobs.policy_changed(address)
    })
    const policy = get_replication_policy(context, address)
    context.events.emit({ type: 'library:replication-policy-changed', payload: { library_address: address, policy } })
    return policy
  },

  list_capabilities: async (address) => list_capabilities(context, address),
  issue_capability: async (input) => await issue_capability(context, input),
  revoke_capability: async ({ library_address, capability_id, via_capability_id }) => {
    await revoke_capability(context, { library_address, revokes: capability_id, capability_id: via_capability_id })
  },

  // An open library with no About record has a null name (chapter 7 About);
  // only a library the node does not hold is unknown.
  get_about: async (address) => {
    const about = get_about({ db: context.db, library_address: address })
    if (about !== undefined) return to_api_about(about)
    return context.libraries.get(address) === undefined ? undefined : { library_address: address, name: null }
  },

  set_about: async ({ address, name, capability_id }) => {
    await write_about(context, { address, name, capability_id })
    return read_about(context, address)
  },

  get_library_profile: async (address) => {
    if (find_own_library(context, address) === undefined) return announced_profile(context, address)
    return to_api_profile(require_identity(context).key_pair.public_key, read_profile(context))
  },

  list_listens: async ({ offset, limit }) => {
    const pins = identity_state(context).pins
    const { items, total } = list_listens({
      db: context.db, own_library_addresses: own_recordstore_addresses(context), listens_addresses: listens_addresses(context), label_libraries: default_label_libraries(context), offset, limit
    })
    const tracks = items.flatMap(({ track, count, timestamps_ms }) => {
      const api_track = track === undefined ? undefined : to_api_track(track, pins)
      return api_track === undefined ? [] : [{ ...api_track, listen_count: count, listen_timestamps_ms: timestamps_ms }]
    })
    return { items: tracks, total }
  },

  // Listens go to the identity's listens library (§4.8.3).
  record_listen: async ({ track_id, library_address }) => {
    await serialise_write(context, async () => {
      const { key_pair } = require_identity(context)
      const listens_address = await ensure_listens_library(context)
      await record_listen({ libraries: context.libraries, listens_address, key_pair, track_id, address: library_address })
    })
    return get_listen_count({ db: context.db, track_id, listens_addresses: listens_addresses(context) })
  },

  get_identity: async () => {
    const { key_pair, identity_address } = require_identity(context)
    return { public_key: key_pair.public_key, meta_log_address: identity_address, own_library_address: default_own_library(context) ?? '' }
  },

  get_profile: async () => to_api_profile(require_identity(context).key_pair.public_key, read_profile(context)),

  set_profile: async (profile) => to_api_profile(require_identity(context).key_pair.public_key, await write_profile(context, profile)),

  list_own_libraries: async () => {
    const scope = library_scope(context)
    return [...scope.own.keys()].flatMap((address) => describe_library(context, address, scope) ?? [])
  },

  create_own_library: async ({ name }) => {
    const address = await create_own_library(context)
    await write_about(context, { address, name })
    return require_library(context, address)
  },

  retire_own_library: async (address) => { await retire_own_library(context, address) },

  list_held_capabilities: async () => held_capabilities(context),

  read_meta_log: async (query) => read_meta_log(context, query)
})
