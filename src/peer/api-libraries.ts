// ApiPeer library, About, and listen methods.

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { parse_library_address } from '#encoding/library-address.ts'
import { assert_payload_size } from '#encoding/size-bounds.ts'
import { build_about_envelope, build_log_envelope } from '#entry/envelope.ts'
import { compute_about_id, compute_log_id } from '#entry/id.ts'
import { build_del_operation, build_put_operation } from '#entry/operations.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { get_about, get_library_summary, get_listen_count, list_linked_libraries, list_listens } from '#query-db/queries.ts'
import { ProtocolError } from '#types/errors.ts'
import { PeerError, type About, type ApiPeer, type Library } from '#types/peer.ts'
import { linked_addresses, require_identity, serialise_write, type PeerContext } from './context.ts'
import { record_listen } from './listens.ts'
import { to_api_about, to_api_library, to_api_track } from './views.ts'

const store_payload = async (context: PeerContext, value: Record<string, unknown>): Promise<string> => {
  const bytes = encode_canonical(value)
  assert_payload_size(bytes)
  const cid = compute_cid_string(bytes)
  await context.content_store.put(cid, bytes)
  return cid
}

const own_oplog = (context: PeerContext) => {
  const oplog = context.libraries.get(require_identity(context).own_address)?.oplog
  if (oplog === undefined) throw new Error('the own library is not open')
  return oplog
}

// A linked library opens once its AC chain is in the local store; until the
// replication stage fetches it, an unopenable one stays linked and loading.
export const try_open_library = async (context: PeerContext, address: string): Promise<void> => {
  try {
    await context.libraries.open_library(address)
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error
  }
}

const describe_library = (context: PeerContext, address: string): Library | undefined => {
  const own_address = require_identity(context).own_address
  const is_own = address === own_address
  const link = is_own ? undefined : list_linked_libraries({ db: context.db, library_address: own_address }).find((linked) => linked.address === address)
  if (!is_own && link === undefined) return undefined
  return to_api_library({
    address,
    summary: get_library_summary({ db: context.db, library_address: address }),
    about: get_about({ db: context.db, library_address: address }),
    alias: link?.alias ?? null,
    is_own,
    is_linked: link !== undefined,
    is_loading: context.libraries.get(address) === undefined
  })
}

const require_library = (context: PeerContext, address: string): Library => {
  const library = describe_library(context, address)
  if (library === undefined) throw new PeerError('not_found', `unknown library: ${address}`)
  return library
}

export const create_library_methods = (context: PeerContext): Pick<ApiPeer,
  'list_libraries' | 'get_library' | 'link_library' | 'unlink_library' | 'connect_library' | 'disconnect_library' |
  'get_about' | 'set_about' | 'list_listens' | 'record_listen'> => ({
  list_libraries: async () => [require_identity(context).own_address, ...linked_addresses(context)]
    .flatMap((address) => describe_library(context, address) ?? []),

  get_library: async (address) => describe_library(context, address),

  // A link is a log entry in the own library (§2.5).
  link_library: async ({ address, alias }) => {
    parse_library_address(address)
    await serialise_write(context, async () => {
      const { key_pair, own_address, listens_address } = require_identity(context)
      if (address === own_address || address === listens_address) throw new PeerError('conflict', `a peer does not link its own library: ${address}`)
      const content_cid = await store_payload(context, alias === null ? { address } : { address, alias })
      const envelope = build_log_envelope({ id: compute_log_id(address), content_cid })
      await context.libraries.append({ library_address: own_address, payload: build_put_operation({ envelope }), key_pair })
    })
    await try_open_library(context, address)
    const about = get_about({ db: context.db, library_address: address })
    context.events.emit({ type: 'library:linked', payload: { library_address: address, ...(about === undefined ? {} : { about: to_api_about(about) }) } })
    return require_library(context, address)
  },

  // §4.6: the DEL ends the link, and the manager releases what only it held.
  unlink_library: async (address) => {
    await serialise_write(context, async () => {
      const { key_pair, own_address, listens_address } = require_identity(context)
      if (address === own_address || address === listens_address) throw new PeerError('forbidden', `the own libraries cannot be unlinked: ${address}`)
      if (get_live_entry({ oplog: own_oplog(context), key: compute_log_id(address) }) !== undefined) {
        const payload = build_del_operation({ key: compute_log_id(address), type: 'log' })
        await context.libraries.append({ library_address: own_address, payload, key_pair })
      }
      if (context.libraries.get(address) !== undefined) await context.libraries.unlink_library(address)
    })
    context.events.emit({ type: 'library:unlinked', payload: { library_address: address } })
  },

  // Replication starts and stops here in the next stage; a single peer only
  // opens or closes the library.
  connect_library: async (address) => {
    await try_open_library(context, address)
    context.events.emit({ type: 'library:connected', payload: { library_address: address } })
  },
  disconnect_library: async (address) => {
    if (context.libraries.get(address) !== undefined) await context.libraries.close_library(address)
    context.events.emit({ type: 'library:disconnected', payload: { library_address: address } })
  },

  get_about: async (address) => {
    const about = get_about({ db: context.db, library_address: address })
    return about === undefined ? undefined : to_api_about(about)
  },

  // The address field is stamped with the own address (§2.6); null clears a field.
  set_about: async ({ address, fields }) => {
    await serialise_write(context, async () => {
      const { key_pair, own_address } = require_identity(context)
      if (address !== own_address) throw new PeerError('forbidden', `not the owner of ${address}`)
      const current: Partial<About> = get_about({ db: context.db, library_address: address }) ?? {}
      const merged = { name: current.name, bio: current.bio, location: current.location, avatar: current.avatar, ...fields }
      const content = Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === 'string'))
      const content_cid = await store_payload(context, { ...content, address })
      const envelope = build_about_envelope({ id: compute_about_id(address), content_cid })
      try {
        await context.libraries.append({ library_address: own_address, payload: build_put_operation({ envelope }), key_pair })
      } catch (error) {
        // An unchanged profile is already the live entry (§2.10).
        if (!(error instanceof ProtocolError && error.code === 'duplicate_entry')) throw error
      }
    })
    const about = get_about({ db: context.db, library_address: address })
    if (about === undefined) throw new Error(`the About entry of ${address} did not index`)
    return to_api_about(about)
  },

  list_listens: async ({ offset, limit }) => {
    const { own_address, listens_address } = require_identity(context)
    const { items, total } = list_listens({ db: context.db, own_library_address: own_address, listens_addresses: [listens_address], offset, limit })
    const tracks = items.flatMap(({ track, count, timestamps_ms }) => {
      const api_track = track === undefined ? undefined : to_api_track(track)
      return api_track === undefined ? [] : [{ ...api_track, listen_count: count, listen_timestamps_ms: timestamps_ms }]
    })
    return { items: tracks, total }
  },

  record_listen: async ({ track_id, library_address }) => {
    await serialise_write(context, async () => {
      const { key_pair, listens_address } = require_identity(context)
      await record_listen({ libraries: context.libraries, listens_address, key_pair, track_id, address: library_address })
    })
    return get_listen_count({ db: context.db, track_id })
  }
})
