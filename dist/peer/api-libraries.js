// ApiPeer library, identity, capability, About, and listen methods.
import { encode_canonical } from '#encoding/canonical-bytes.ts';
import { compute_cid_string } from '#encoding/cid.ts';
import { parse_library_address } from '#encoding/library-address.ts';
import { assert_payload_size } from '#encoding/size-bounds.ts';
import { build_about_envelope } from '#entry/envelope.ts';
import { compute_about_id } from '#entry/id.ts';
import { build_put_operation } from '#entry/operations.ts';
import { get_about, get_listen_count, list_listens } from '#query-db/queries.ts';
import { ProtocolError } from '#types/errors.ts';
import { PeerError } from '#types/peer.ts';
import { held_capabilities, issue_capability, list_capabilities, revoke_capability } from "./capabilities.js";
import { require_identity, serialise_write } from "./context.js";
import { describe_library } from "./describe.js";
import { connect_address, create_own_library, ensure_listens_library, link_address, read_meta_log, retire_own_library, unlink_library } from "./identity-library.js";
import { record_listen } from "./listens.js";
import { default_own_library, find_own_library, identity_state, linked_addresses, own_libraries, own_recordstore_addresses } from "./ownership.js";
import { effective_policy, get_replication_policy, validate_policy } from "./policy.js";
import { to_api_about, to_api_track } from "./views.js";
import { append_write, resolve_write_target } from "./write-target.js";
const store_payload = async (context, value) => {
    const bytes = encode_canonical(value);
    assert_payload_size(bytes);
    const cid = compute_cid_string(bytes);
    await context.content_store.put(cid, bytes);
    return cid;
};
const require_library = (context, address) => {
    const library = describe_library(context, address);
    if (library === undefined)
        throw new PeerError('not_found', `unknown library: ${address}`);
    return library;
};
// The libraries GET /libraries lists: own ones, the link set, and any the
// identity holds a capability in. The identity library is never listed.
const known_addresses = (context) => {
    const addresses = new Set([...own_libraries(context).map(({ address }) => address), ...linked_addresses(context)]);
    for (const { chain } of context.libraries.list()) {
        if (chain.type === 'recordstore' && !addresses.has(chain.address) && describe_library(context, chain.address) !== undefined)
            addresses.add(chain.address);
    }
    return [...addresses];
};
// Writes an About entry, owned or under a capability granting
// library.update_about (§2.6, §3.5.6). The address field is stamped and null
// clears a field.
const write_about = async (context, { address, fields, capability_id }) => {
    await serialise_write(context, async () => {
        const target = resolve_write_target(context, { library_address: address, capability_id });
        const current = get_about({ db: context.db, library_address: address }) ?? {};
        const merged = { name: current.name, bio: current.bio, location: current.location, avatar: current.avatar, ...fields };
        const content = Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === 'string'));
        const content_cid = await store_payload(context, { ...content, address });
        const envelope = build_about_envelope({ id: compute_about_id(address), content_cid });
        try {
            await append_write(context, target, build_put_operation({ envelope, capability_id: target.capability_id }));
        }
        catch (error) {
            // An unchanged profile is already the live entry (§2.10).
            if (!(error instanceof ProtocolError && error.code === 'duplicate_entry'))
                throw error;
        }
    });
};
const read_about = (context, address) => {
    const about = get_about({ db: context.db, library_address: address });
    if (about === undefined)
        throw new Error(`the About entry of ${address} did not index`);
    return to_api_about(about);
};
const listens_addresses = (context) => own_libraries(context).filter(({ type }) => type === 'listens').map(({ address }) => address);
export const create_library_methods = (context) => ({
    list_libraries: async () => known_addresses(context).flatMap((address) => describe_library(context, address) ?? []),
    get_library: async (address) => describe_library(context, address),
    // A link is a record in the identity library (§4.8.4).
    link_library: async ({ address, alias }) => {
        parse_library_address(address);
        await link_address(context, { address, alias });
        const about = get_about({ db: context.db, library_address: address });
        context.events.emit({ type: 'library:linked', payload: { library_address: address, ...(about === undefined ? {} : { about: to_api_about(about) }) } });
        return require_library(context, address);
    },
    unlink_library: async (address) => {
        await unlink_library(context, address);
        context.events.emit({ type: 'library:unlinked', payload: { library_address: address } });
    },
    // Connect starts or resumes replication; disconnect pauses it and leaves
    // the oplog open (§5.4.4). Content fetches follow (§4.6.1).
    connect_library: async (address) => {
        await serialise_write(context, async () => { await connect_address(context, address); });
        context.blobs.retry();
        context.events.emit({ type: 'library:connected', payload: { library_address: address } });
    },
    disconnect_library: async (address) => {
        await serialise_write(context, async () => { context.replication?.pause(address); });
        context.events.emit({ type: 'library:disconnected', payload: { library_address: address } });
    },
    get_replication_policy: async (address) => get_replication_policy(context, address),
    // Node-local: stored in the data directory, never written to a log (§4.6.1).
    set_replication_policy: async ({ address, mode, filter }) => {
        await serialise_write(context, async () => {
            if (find_own_library(context, address) !== undefined)
                throw new PeerError('conflict', `an own library is always replicated in full: ${address}`);
            if (effective_policy(context, address) === undefined)
                throw new PeerError('not_found', `not a linked library: ${address}`);
            const policy = validate_policy({ mode, filter });
            await context.libraries.save_policy({ library_address: address, policy });
            context.policies.set(address, policy);
            await context.blobs.policy_changed(address);
        });
        const policy = get_replication_policy(context, address);
        context.events.emit({ type: 'library:replication-policy-changed', payload: { library_address: address, policy } });
        return policy;
    },
    list_capabilities: async (address) => list_capabilities(context, address),
    issue_capability: async (input) => await issue_capability(context, input),
    revoke_capability: async ({ library_address, capability_id, via_capability_id }) => {
        await revoke_capability(context, { library_address, revokes: capability_id, capability_id: via_capability_id });
    },
    get_about: async (address) => {
        const about = get_about({ db: context.db, library_address: address });
        return about === undefined ? undefined : to_api_about(about);
    },
    set_about: async ({ address, fields, capability_id }) => {
        await write_about(context, { address, fields, capability_id });
        return read_about(context, address);
    },
    list_listens: async ({ offset, limit }) => {
        const pins = identity_state(context).pins;
        const { items, total } = list_listens({
            db: context.db, own_library_addresses: own_recordstore_addresses(context), listens_addresses: listens_addresses(context), offset, limit
        });
        const tracks = items.flatMap(({ track, count, timestamps_ms }) => {
            const api_track = track === undefined ? undefined : to_api_track(track, pins);
            return api_track === undefined ? [] : [{ ...api_track, listen_count: count, listen_timestamps_ms: timestamps_ms }];
        });
        return { items: tracks, total };
    },
    // Listens go to the identity's listens library (§4.8.3).
    record_listen: async ({ track_id, library_address }) => {
        await serialise_write(context, async () => {
            const { key_pair } = require_identity(context);
            const listens_address = await ensure_listens_library(context);
            await record_listen({ libraries: context.libraries, listens_address, key_pair, track_id, address: library_address });
        });
        return get_listen_count({ db: context.db, track_id, listens_addresses: listens_addresses(context) });
    },
    get_identity: async () => {
        const { key_pair, identity_address } = require_identity(context);
        return { public_key: key_pair.public_key, meta_log_address: identity_address, own_library_address: default_own_library(context) ?? '' };
    },
    list_own_libraries: async () => own_libraries(context).flatMap(({ address }) => describe_library(context, address) ?? []),
    create_own_library: async ({ discriminator, about }) => {
        const address = await create_own_library(context, { discriminator });
        if (about !== undefined && Object.values(about).some((value) => typeof value === 'string')) {
            await write_about(context, { address, fields: about });
        }
        return require_library(context, address);
    },
    retire_own_library: async (address) => { await retire_own_library(context, address); },
    list_held_capabilities: async () => held_capabilities(context),
    read_meta_log: async (query) => read_meta_log(context, query)
});
