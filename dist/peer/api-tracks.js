// ApiPeer track, tag, pin, audio, and image methods. Writes go to a write target:
// an own library, or one written under a capability (chapter 7).
import { encode_canonical } from '#encoding/canonical-bytes.ts';
import { compute_cid_string } from '#encoding/cid.ts';
import { assert_payload_size } from '#encoding/size-bounds.ts';
import { build_track_envelope } from '#entry/envelope.ts';
import { build_identity_del, build_identity_put, canonical_cid, identity_record_key } from '#entry/identity-record.ts';
import { build_del_operation, build_put_operation, is_put } from '#entry/operations.ts';
import { decode_payload, validate_track_content } from '#entry/payload.ts';
import { ingest_cid } from '#ingest/pipeline-cid.ts';
import { blob_decoded_fields, with_decoded_fields } from '#ingest/rederive.ts';
import { resolve_current_state } from '#oplog/current-state.ts';
import { get_live_entry } from '#oplog/dag.ts';
import { get_track, list_tags, list_tracks } from '#query-db/queries.ts';
import { ProtocolError } from '#types/errors.ts';
import { IngestError } from '#types/ingest.ts';
import { PeerError } from '#types/peer.ts';
import { ingest_into, require_identity, require_toolchain, serialise_write } from "./context.js";
import { append_identity_record } from "./identity-library.js";
import { identity_state, own_recordstore_addresses, visible_addresses } from "./ownership.js";
import { to_api_track, to_api_tracks } from "./views.js";
import { append_write, as_write_refusal, resolve_write_target } from "./write-target.js";
// One library's view of a track.
const library_track = (context, { address, track_id }) => {
    const row = get_track({ db: context.db, track_id, own_library_addresses: own_recordstore_addresses(context), library_addresses: [address] });
    const track = row === undefined ? undefined : to_api_track(row, identity_state(context).pins);
    if (track === undefined)
        throw new PeerError('not_found', `not in ${address}: ${track_id}`);
    return track;
};
// The envelope a write builds on. Under a capability it is the §3.5.6 base
// entry, which ignores inertness, so the new PUT keeps exactly the tags the
// verifier will check it against.
const live_envelope = (target, track_id) => {
    const { oplog } = target.handle;
    const live = target.capability_id === undefined
        ? get_live_entry({ oplog, key: track_id })
        : resolve_current_state([...oplog.key_entries.get(track_id) ?? []].flatMap((hash) => oplog.entries.get(hash) ?? []));
    if (live === undefined || !is_put(live.operation) || live.operation.value.type !== 'track') {
        throw new PeerError('not_found', `not in ${target.address}: ${track_id}`);
    }
    return live.operation.value;
};
// A label change as the API takes it: set, or add and remove, with no label
// both added and removed.
const checked_label_change = ({ add, remove, set }) => {
    if (add === undefined && remove === undefined && set === undefined)
        throw new PeerError('invalid', 'a label change gives add, remove, or set');
    if (set !== undefined && (add !== undefined || remove !== undefined))
        throw new PeerError('invalid', 'set replaces the labels, so it excludes add and remove');
    const both = (add ?? []).find((label) => (remove ?? []).includes(label));
    if (both !== undefined)
        throw new PeerError('invalid', `a label is both added and removed: ${both}`);
    return { add, remove, set };
};
// The labels a change leaves, or undefined when they stay equal as a set.
// Kept labels keep their order and added ones follow; set gives its own.
const changed_labels = (current, { add = [], remove = [], set }) => {
    const next = [...new Set(set ?? [...current.filter((label) => !remove.includes(label)), ...add])];
    const before = new Set(current);
    return next.length === before.size && next.every((label) => before.has(label)) ? undefined : next;
};
// A relabel PUT: the envelope's content with new tags (§2.4.3).
const relabel_payload = (target, { envelope, tags }) => build_put_operation({
    envelope: build_track_envelope({ id: envelope.id, content_cid: envelope.content, tags }),
    capability_id: target.capability_id
});
// A failed batch item's API code: a refusal of its own, or a protocol rule
// its entry broke. Anything else fails the batch.
const BATCH_ITEM_CODES = {
    not_found: 'NOT_FOUND',
    forbidden: 'FORBIDDEN',
    capability_expired: 'CAPABILITY_EXPIRED',
    capability_revoked: 'CAPABILITY_REVOKED',
    invalid: 'VALIDATION_ERROR'
};
const batch_item_failure = (track_id, error) => {
    const refusal = as_write_refusal(error);
    if (refusal instanceof ProtocolError)
        return { track_id, status: 'failed', error: { code: 'VALIDATION_ERROR', message: refusal.message } };
    if (refusal instanceof PeerError && Object.hasOwn(BATCH_ITEM_CODES, refusal.code)) {
        return { track_id, status: 'failed', error: { code: BATCH_ITEM_CODES[refusal.code], message: refusal.message } };
    }
    throw refusal;
};
// Relabelling appends a new PUT of the same content with the new tags (§2.4.3).
const relabel = async (context, { track_id, library_address, capability_id, tags }) => await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address, capability_id });
    const envelope = live_envelope(target, track_id);
    const next = tags(envelope.tags ?? []);
    if (next !== undefined)
        await append_write(context, target, relabel_payload(target, { envelope, tags: next }));
    return library_track(context, { address: target.address, track_id });
});
// The live entry's content payload, which a correction rewrites.
const stored_content = async (context, { envelope, track_id }) => {
    const stored = await context.content_store.get(envelope.content);
    if (stored === undefined)
        throw new PeerError('conflict', `the content payload of ${track_id} is not stored on this node`);
    return validate_track_content(decode_payload(stored));
};
// A correction (§2.4.3, §6.4.4): a new content object for the same audio, PUT
// under the same id with the envelope's labels kept. The same content appends
// nothing.
const supersede_content = async (context, { target, envelope, content }) => {
    const bytes = encode_canonical(validate_track_content(content));
    assert_payload_size(bytes);
    const content_cid = compute_cid_string(bytes);
    if (content_cid === envelope.content)
        return;
    await context.content_store.put(content_cid, bytes);
    const payload = build_put_operation({
        envelope: build_track_envelope({ id: envelope.id, content_cid, ...(envelope.tags === undefined ? {} : { tags: envelope.tags }) }),
        capability_id: target.capability_id
    });
    await append_write(context, target, payload);
};
// content.tags with each given field set, or removed by null. The
// fingerprint derives the track id, so it never changes.
const corrected_tags = (current, changes) => {
    const fingerprint = current.acoustid_fingerprint;
    if (Object.hasOwn(changes, 'acoustid_fingerprint') && changes.acoustid_fingerprint !== fingerprint) {
        throw new PeerError('invalid', 'acoustid_fingerprint derives the track id and cannot change');
    }
    const tags = { ...current };
    for (const [name, value] of Object.entries(changes)) {
        if (value === null)
            delete tags[name];
        else
            tags[name] = value;
    }
    return tags;
};
// A pin keys on the canonical CID (§4.8.2); a string that is no CID is the
// request's error.
const pin_key_of = (cid) => {
    try {
        return canonical_cid(cid);
    }
    catch {
        throw new PeerError('invalid', `not a CID: ${cid}`);
    }
};
export const create_track_methods = (context) => ({
    list_tracks: async ({ library_addresses, ...query }) => {
        const { items, total } = list_tracks({
            db: context.db,
            own_library_addresses: own_recordstore_addresses(context),
            library_addresses: library_addresses ?? visible_addresses(context),
            ...query
        });
        return { items: to_api_tracks(items, identity_state(context).pins), total };
    },
    // CID ingest (§6.4.3): the content object must already be stored locally.
    // A new track carries the given labels in its PUT, and a held one is
    // relabelled to them.
    add_track: async ({ content_cid, tags, library_address, capability_id }) => {
        const target = resolve_write_target(context, { library_address, capability_id });
        let track_id;
        let existing;
        try {
            // Nothing to prepare: the content object is already stored.
            ({ track_id, existing } = await ingest_into(context, target, {
                prepare: async () => undefined,
                commit: async ({ target: track_target }) => await ingest_cid({ content_cid, target: track_target, ...(tags === undefined ? {} : { tags: [...new Set(tags)] }) }),
                blobs: () => []
            }));
        }
        catch (error) {
            if (error instanceof ProtocolError && error.code === 'content_unavailable')
                throw new PeerError('not_found', error.message);
            throw as_write_refusal(error);
        }
        if (existing && tags !== undefined) {
            return await relabel(context, { track_id, library_address: target.address, capability_id, tags: (current) => changed_labels(current, { set: tags }) });
        }
        return library_track(context, { address: target.address, track_id });
    },
    // A content.tags correction (§2.4.3): a new content object for the same
    // audio, PUT under the same id with the envelope's labels kept.
    update_track: async ({ track_id, tags, library_address, capability_id }) => await serialise_write(context, async () => {
        const target = resolve_write_target(context, { library_address, capability_id });
        const envelope = live_envelope(target, track_id);
        const content = await stored_content(context, { envelope, track_id });
        await supersede_content(context, { target, envelope, content: { ...content, tags: corrected_tags(content.tags, tags) } });
        return library_track(context, { address: target.address, track_id });
    }),
    // Audio re-derivation (§6.4.4). The blob decodes outside the write lock,
    // and the fields apply to whatever content is live once it is held, so a
    // concurrent tag correction is kept.
    rederive_track: async ({ track_id, library_address, capability_id }) => {
        const target = resolve_write_target(context, { library_address, capability_id });
        const { hash, size } = await stored_content(context, { envelope: live_envelope(target, track_id), track_id });
        const blob = await context.audio.read_local(hash);
        if (blob === undefined)
            throw new PeerError('conflict', `the audio blob of ${track_id} is not stored on this node`);
        let fields;
        try {
            fields = await blob_decoded_fields({ blob, size: size, toolchain: await require_toolchain(context) });
        }
        catch (error) {
            if (error instanceof IngestError)
                throw new PeerError('conflict', `the audio blob of ${track_id} cannot be decoded: ${error.message}`);
            throw error;
        }
        return await serialise_write(context, async () => {
            const envelope = live_envelope(target, track_id);
            const content = await stored_content(context, { envelope, track_id });
            if (content.hash !== hash)
                throw new PeerError('conflict', `the audio of ${track_id} changed while it was decoded`);
            const rederived = with_decoded_fields(content, fields);
            if (rederived !== undefined)
                await supersede_content(context, { target, envelope, content: rederived });
            return library_track(context, { address: target.address, track_id });
        });
    },
    // No capability action authorises a DEL (§3.5.6), so only an owner removes.
    remove_track: async ({ track_id, library_address }) => {
        await serialise_write(context, async () => {
            const target = resolve_write_target(context, { library_address });
            live_envelope(target, track_id);
            await append_write(context, target, build_del_operation({ key: track_id, type: 'track' }));
        });
    },
    pin_track: async (cid) => {
        const key = pin_key_of(cid);
        await serialise_write(context, async () => {
            if (identity_state(context).pins.has(key))
                return;
            await append_identity_record(context, build_identity_put({ type: 'pin', v: 1, timestamp: Date.now(), cid: key }));
        });
    },
    unpin_track: async (cid) => {
        const key = pin_key_of(cid);
        await serialise_write(context, async () => {
            if (!identity_state(context).pins.has(key))
                throw new PeerError('not_found', `not pinned: ${cid}`);
            await append_identity_record(context, build_identity_del({ type: 'pin', key: identity_record_key({ type: 'pin', v: 1, timestamp: 0, cid: key }) }));
        });
    },
    list_tags: async ({ library_addresses, prefix }) => list_tags({ db: context.db, library_addresses: library_addresses ?? visible_addresses(context), prefix }),
    add_tag: async ({ track_id, tag, library_address, capability_id }) => await relabel(context, {
        track_id,
        library_address,
        capability_id,
        tags: (current) => {
            if (current.includes(tag))
                throw new PeerError('conflict', `already tagged ${tag}: ${track_id}`);
            return [...current, tag];
        }
    }),
    remove_tag: async ({ track_id, tag, library_address, capability_id }) => await relabel(context, {
        track_id,
        library_address,
        capability_id,
        tags: (current) => current.includes(tag) ? current.filter((label) => label !== tag) : undefined
    }),
    change_labels: async ({ track_id, add, remove, set, library_address, capability_id }) => {
        const change = checked_label_change({ add, remove, set });
        return await relabel(context, { track_id, library_address, capability_id, tags: (current) => changed_labels(current, change) });
    },
    // Each item builds from the live entry just before its append, so items
    // naming one track apply one after the other.
    change_labels_batch: async ({ items, library_address, capability_id }) => {
        const changes = items.map(({ track_id, ...change }) => ({ track_id, change: checked_label_change(change) }));
        return await serialise_write(context, async () => {
            const target = resolve_write_target(context, { library_address, capability_id });
            const labels = [];
            const outcomes = await context.libraries.append_many({
                library_address: target.address,
                key_pair: require_identity(context).key_pair,
                builds: changes.map(({ track_id, change }, index) => () => {
                    const envelope = live_envelope(target, track_id);
                    const next = changed_labels(envelope.tags ?? [], change);
                    labels[index] = next ?? [...new Set(envelope.tags ?? [])];
                    return next === undefined ? undefined : relabel_payload(target, { envelope, tags: next });
                })
            });
            return outcomes.map((outcome, index) => {
                const { track_id } = changes[index];
                if (!outcome.ok)
                    return batch_item_failure(track_id, outcome.error);
                return { track_id, status: outcome.entry === undefined ? 'unchanged' : 'updated', tags: labels[index] };
            });
        });
    },
    get_audio: async (cid) => await context.audio.read(cid),
    has_audio: async (cid) => await context.audio.read_local(cid) !== undefined,
    get_image: async (cid, { local_only = false } = {}) => local_only ? await context.images.read_local(cid) : await context.images.read(cid)
});
