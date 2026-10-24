// The peer's RECORD topic (§5.3): announcing its own recordstores and its
// open, non-empty linked libraries, each with its About entry, plus the
// profile entries of their owners, and verifying what other peers announce.
// An announced library counts for a peer only once its AC chain resolves;
// until then it is a hint and changes nothing local. A verified profile of a
// library's single-key owner is kept, so its avatar is kept as artwork is
// (§4.6.1) and it is announced on in turn.
import { PROFILE_KEY } from '#entry/identity-record.ts';
import { is_about_put } from '#entry/operations.ts';
import { ABOUT_KEY } from '#entry/records.ts';
import { RECORD_TOPIC } from '#fabric/pubsub.ts';
import { get_live_entry } from '#oplog/dag.ts';
import { compare_current_state } from '#oplog/current-state.ts';
import { create_announcer, verify_announced_library, verify_announced_profile } from '#replication/announcement.ts';
import { announced_entry, decode_announcement, encode_announcement } from '#replication/messages.ts';
import { default_own_library, linked_addresses, own_recordstore_addresses } from "./ownership.js";
export const create_announced_state = () => ({ profiles: new Map(), owners: new Map() });
// The live entry of a key in an open library.
const live_entry = (context, library_address, key) => {
    const oplog = context.libraries.get(library_address)?.oplog;
    return oplog === undefined ? undefined : get_live_entry({ oplog, key });
};
// The signed entry carrying an open library's current About record.
const about_entry = (context, library_address) => {
    const live = live_entry(context, library_address, ABOUT_KEY);
    return live === undefined || !is_about_put(live.operation) ? undefined : live.entry;
};
// The single write-list key of an open library, if it has one.
const single_owner = (context, library_address) => {
    const write_list = context.libraries.get(library_address)?.chain.write_list;
    return write_list?.length === 1 ? write_list[0] : undefined;
};
// The announcement (§5.3.2): own recordstores first, the default one leading,
// then each open, non-empty link; never the identity, listens or labels
// library. Profiles are this identity's own and the verified ones of linked
// owners.
const build_announcement = (context) => {
    if (!context.config.announce || context.identity === undefined)
        return undefined;
    const { key_pair, identity_address } = context.identity;
    const default_address = default_own_library(context);
    const own = own_recordstore_addresses(context).sort((a, b) => Number(b === default_address) - Number(a === default_address));
    const linked = linked_addresses(context).filter((address) => !own.includes(address) && (context.libraries.get(address)?.oplog.entries.size ?? 0) > 0);
    const libraries = [...own, ...linked].map((address) => {
        const about = about_entry(context, address);
        return about === undefined ? { address } : { address, about: announced_entry(about) };
    });
    if (libraries.length === 0)
        return undefined;
    const owners = new Map(libraries.flatMap(({ address }) => {
        const owner = single_owner(context, address);
        return owner === undefined ? [] : [[address, owner]];
    }));
    const own_profile = live_entry(context, identity_address, `profile:${PROFILE_KEY}`)?.entry;
    const profiles = new Map(own_profile === undefined ? [] : [[key_pair.public_key, announced_entry(own_profile)]]);
    for (const owner of owners.values()) {
        const profile = context.announced.profiles.get(owner);
        if (profile !== undefined && !profiles.has(owner))
            profiles.set(owner, announced_entry(profile.hashed.entry));
    }
    return encode_announcement({ libraries, profiles: [...profiles.values()], own_count: own.length, owners });
};
export const create_peer_announcements = ({ context, network, timers, get_block, on_peer_join, on_peer_leave, on_library_verified, on_profile }) => {
    const { pubsub } = network;
    const announced = new Map();
    const removals = [];
    const announcer = create_announcer({
        pubsub,
        interval_ms: context.config.announce_interval_ms,
        timers,
        build: async () => build_announcement(context)
    });
    // Keeps a verified profile unless the one kept sorts after it (§4.4.2).
    const keep_profile = (profile) => {
        const key = profile.hashed.entry.key;
        if (key === context.identity?.key_pair.public_key)
            return;
        const kept = context.announced.profiles.get(key);
        if (kept !== undefined && compare_current_state(profile.hashed, kept.hashed) >= 0)
            return;
        context.announced.profiles.set(key, profile);
        on_profile?.(key);
    };
    // §5.3.4: one library at a time, so a hostile announcement costs fetches
    // serially. A profile is an owner's only when some verified library's
    // write list is that single key (§5.3.2).
    const verify = async (record, profiles) => {
        const owners = new Set();
        for (const hint of record.hints) {
            const library = await verify_announced_library({ announced: hint, get_block });
            if (library === undefined)
                continue;
            record.verified.add(hint.address);
            if (library.chain.write_list.length === 1) {
                const owner = library.chain.write_list[0];
                owners.add(owner);
                context.announced.owners.set(hint.address, owner);
            }
            on_library_verified?.(hint.address);
        }
        for (const entry of profiles) {
            const profile = verify_announced_profile(entry);
            if (profile !== undefined && owners.has(profile.hashed.entry.key))
                keep_profile(profile);
        }
    };
    const receive = ({ from, data }) => {
        const message = decode_announcement(data);
        if (message === undefined)
            return;
        const record = { hints: message.libraries, verified: new Set() };
        announced.set(from, record);
        verify(record, message.profiles).catch(() => { });
    };
    return {
        start: async () => {
            await pubsub.subscribe(RECORD_TOPIC, receive);
            removals.push(pubsub.on_peer_join(RECORD_TOPIC, (peer_id) => {
                announcer.peer_joined(peer_id);
                on_peer_join(peer_id);
            }), pubsub.on_peer_leave(RECORD_TOPIC, (peer_id) => {
                announced.delete(peer_id);
                on_peer_leave(peer_id);
            }));
            announcer.announce_self();
        },
        stop: async () => {
            announcer.stop();
            for (const remove of removals.splice(0))
                remove();
            await pubsub.unsubscribe(RECORD_TOPIC);
        },
        announced_by: (peer_id) => announced.get(peer_id)
    };
};
