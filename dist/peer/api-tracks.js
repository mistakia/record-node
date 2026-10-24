// ApiPeer track, label, pin, audio, and image methods. Writes go to a write
// target: an own library, or one written under a capability (chapter 7). A
// label write goes to the labels library unless it names a target, takes any
// track id, held or not, and appends at most one label record (§2.5).
import { encode_canonical } from '#encoding/canonical-bytes.ts';
import { compute_cid_string } from '#encoding/cid.ts';
import { assert_label, assert_payload_size } from '#encoding/size-bounds.ts';
import { build_track_envelope } from '#entry/envelope.ts';
import { build_identity_del, build_identity_put, canonical_cid, identity_record_key } from '#entry/identity-record.ts';
import { build_del_operation, build_put_operation, is_labels_put, is_put } from '#entry/operations.ts';
import { decode_payload, validate_track_content } from '#entry/payload.ts';
import { applies_label, label_state_key } from '#entry/records.ts';
import { ingest_cid } from '#ingest/pipeline-cid.ts';
import { check_payload, is_empty_diff, labels_payload } from '#ingest/put-track.ts';
import { blob_decoded_fields, with_decoded_fields } from '#ingest/rederive.ts';
import { get_live_entry } from '#oplog/dag.ts';
import { get_track, list_library_labels, list_tags, list_tracks, track_labels } from '#query-db/queries.ts';
import { ProtocolError } from '#types/errors.ts';
import { IngestError } from '#types/ingest.ts';
import { PeerError } from '#types/peer.ts';
import { ingest_into, require_identity, require_toolchain, serialise_write } from "./context.js";
import { append_identity_record } from "./identity-library.js";
import { default_label_libraries, identity_state, own_recordstore_addresses, visible_addresses } from "./ownership.js";
import { to_api_track, to_api_tracks } from "./views.js";
import { append_write, as_write_refusal, resolve_write_target } from "./write-target.js";
const TRACK_ID_PATTERN = /^[0-9a-f]{64}$/;
// One library's view of a track, with the labels of the default
// label_libraries for that library.
const library_track = (context, { address, track_id }) => {
    const row = get_track({
        db: context.db,
        track_id,
        own_library_addresses: own_recordstore_addresses(context),
        library_addresses: [address],
        label_libraries: default_label_libraries(context, [address])
    });
    const track = row === undefined ? undefined : to_api_track(row, identity_state(context).pins);
    if (track === undefined)
        throw new PeerError('not_found', `not in ${address}: ${track_id}`);
    return track;
};
// The answer to a label write (chapter 7 LabelWriteResult): the track over
// every library the node shows, with the default label_libraries, or, when
// none of them holds it, the target's labels on the track id.
const label_write_result = (context, { track_id, tags }) => {
    const row = get_track({
        db: context.db,
        track_id,
        own_library_addresses: own_recordstore_addresses(context),
        library_addresses: visible_addresses(context),
        label_libraries: default_label_libraries(context)
    });
    const track = row === undefined ? undefined : to_api_track(row, identity_state(context).pins);
    return track ?? { track_id, tags: [...tags] };
};
// The live envelope a write builds on.
const live_envelope = (target, track_id) => {
    const live = get_live_entry({ oplog: target.handle.oplog, key: track_id });
    if (live === undefined || !is_put(live.operation)) {
        throw new PeerError('not_found', `not in ${target.address}: ${track_id}`);
    }
    return live.operation.value;
};
// A label as the node writes it (chapter 7): normalised to NFC, then held to
// §2.5's bounds.
const normal_label = (label) => {
    try {
        return assert_label(typeof label === 'string' ? label.normalize('NFC') : label);
    }
    catch (error) {
        if (error instanceof ProtocolError)
            throw new PeerError('invalid', error.message);
        throw error;
    }
};
const normal_labels = (labels) => labels === undefined ? undefined : [...new Set(labels.map(normal_label))];
const checked_track_id = (track_id) => {
    if (!TRACK_ID_PATTERN.test(track_id))
        throw new PeerError('invalid', `a track id is 64 lowercase hex chars: ${track_id}`);
    return track_id;
};
// A label change as the API takes it: set, or add and remove, with no label
// both added and removed once normalised.
const checked_label_change = (change) => {
    if (change.add === undefined && change.remove === undefined && change.set === undefined)
        throw new PeerError('invalid', 'a label change gives add, remove, or set');
    if (change.set !== undefined && (change.add !== undefined || change.remove !== undefined))
        throw new PeerError('invalid', 'set replaces the labels, so it excludes add and remove');
    const [add, remove, set] = [normal_labels(change.add), normal_labels(change.remove), normal_labels(change.set)];
    const both = (add ?? []).find((label) => (remove ?? []).includes(label));
    if (both !== undefined)
        throw new PeerError('invalid', `a label is both added and removed: ${both}`);
    return { add, remove, set };
};
// Whether the library's current entry for the pair, under §4.4.2 and with
// inert entries excluded, is a label record that sets it.
const applied = (oplog, pair) => {
    const key = label_state_key(pair);
    const entry = oplog.current.get(key);
    return entry !== undefined && is_labels_put(entry.operation) && applies_label(entry.operation.value, key);
};
// The labels a library applies to a track id: the index's rows for it,
// which every write waits on, and the labels a change names, each judged by
// the oplog's current state, so a pair merged but not yet indexed still
// counts when the change names it.
const current_labels = (context, { address, oplog }, track_id, change) => {
    const candidates = new Set([
        ...track_labels({ db: context.db, track_id, label_libraries: [address] }),
        ...change.add ?? [], ...change.remove ?? [], ...change.set ?? []
    ]);
    return new Set([...candidates].filter((label) => applied(oplog, [track_id, label])));
};
const next_labels = (current, { add = [], remove = [], set }) => new Set(set ?? [...[...current].filter((label) => !remove.includes(label)), ...add]);
// The pairs that take a track id from one label set to another, so no pair
// is already in its requested state (§2.5).
const label_diff = (track_id, before, after) => ({
    set: [...after].filter((label) => !before.has(label)).map((label) => [track_id, label]),
    unset: [...before].filter((label) => !after.has(label)).map((label) => [track_id, label])
});
const sorted = (labels) => [...labels].sort();
// A failed batch item's API code: a refusal of its own, or a protocol rule
// its pairs broke. Anything else fails the batch.
const BATCH_ITEM_CODES = {
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
// Label changes to one target, in order, appended as one label record
// carrying the pairs they change between them, or nothing when none changes.
// Items naming one track id apply one after the other. Under a capability,
// each of several items is checked alone, so one the capability does not
// authorise fails alone; a single change is refused as the append would be.
// A record over the §2.8.3 entry bound fails the whole write.
const write_labels = async (context, { items, library_address, capability_id }) => await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address, capability_id, kind: 'label' });
    const { oplog } = target.handle;
    const track_target = { oplog, key_pair: require_identity(context).key_pair, content_store: context.content_store, capability_id: target.capability_id };
    const checked = target.capability_id !== undefined && items.length > 1;
    const before = new Map();
    const after = new Map();
    const results = items.map(({ track_id, change }) => {
        const current = after.get(track_id) ?? current_labels(context, { address: target.address, oplog }, track_id, change);
        if (!before.has(track_id))
            before.set(track_id, current);
        const next = next_labels(current, change);
        const diff = label_diff(track_id, current, next);
        if (is_empty_diff(diff)) {
            after.set(track_id, current);
            return { track_id, status: 'unchanged', tags: sorted(current) };
        }
        if (checked) {
            try {
                check_payload(track_target, labels_payload(track_target, diff));
            }
            catch (error) {
                after.set(track_id, current);
                return batch_item_failure(track_id, error);
            }
        }
        after.set(track_id, next);
        return { track_id, status: 'updated', tags: sorted(next) };
    });
    const diffs = [...after].map(([track_id, labels]) => label_diff(track_id, before.get(track_id) ?? new Set(), labels));
    const diff = { set: diffs.flatMap(({ set }) => set), unset: diffs.flatMap(({ unset }) => unset) };
    if (!is_empty_diff(diff)) {
        try {
            await append_write(context, target, labels_payload(track_target, diff));
        }
        catch (error) {
            if (error instanceof ProtocolError && error.code === 'size_exceeded') {
                throw new PeerError('invalid', `the label record is over the §2.8.3 entry bound: ${error.message}`);
            }
            throw error;
        }
    }
    return results;
});
// One label change, answered as chapter 7's LabelWriteResult.
const write_label_change = async (context, { track_id, change, library_address, capability_id }) => {
    const [result] = await write_labels(context, { items: [{ track_id: checked_track_id(track_id), change: checked_label_change(change) }], library_address, capability_id });
    return label_write_result(context, { track_id, tags: result !== undefined && 'tags' in result ? result.tags : [] });
};
// The live entry's content payload, which a correction rewrites.
const stored_content = async (context, { envelope, track_id }) => {
    const stored = await context.content_store.get(envelope.content);
    if (stored === undefined)
        throw new PeerError('conflict', `the content payload of ${track_id} is not stored on this node`);
    return validate_track_content(decode_payload(stored));
};
// A correction (§2.4.3, §6.4.4): a new content object for the same audio, PUT
// under the same id. The same content appends nothing.
const supersede_content = async (context, { target, envelope, content }) => {
    const bytes = encode_canonical(validate_track_content(content));
    assert_payload_size(bytes);
    const content_cid = compute_cid_string(bytes);
    if (content_cid === envelope.content)
        return;
    await context.content_store.put(content_cid, bytes);
    const payload = build_put_operation({
        envelope: build_track_envelope({ id: envelope.id, content_cid }),
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
    list_tracks: async ({ library_addresses, label_libraries, ...query }) => {
        const { items, total } = list_tracks({
            db: context.db,
            own_library_addresses: own_recordstore_addresses(context),
            library_addresses: library_addresses ?? visible_addresses(context),
            label_libraries: label_libraries ?? default_label_libraries(context, library_addresses),
            ...query
        });
        return { items: to_api_tracks(items, identity_state(context).pins), total };
    },
    // CID ingest (§6.4.3): the content object must already be stored locally.
    // tags set the target's labels on the track, as a label change with set
    // would, in a label record after the track PUT in one batch.
    add_track: async ({ content_cid, tags, library_address, capability_id }) => {
        const change = tags === undefined ? undefined : checked_label_change({ set: tags });
        const target = resolve_write_target(context, { library_address, capability_id });
        const labels = change === undefined
            ? undefined
            : (track_id) => {
                const current = current_labels(context, { address: target.address, oplog: target.handle.oplog }, track_id, change);
                return label_diff(track_id, current, next_labels(current, change));
            };
        let track_id;
        try {
            // Nothing to prepare: the content object is already stored.
            ({ track_id } = await ingest_into(context, target, {
                prepare: async () => undefined,
                commit: async ({ target: track_target }) => await ingest_cid({ content_cid, target: track_target, labels }),
                blobs: () => []
            }));
        }
        catch (error) {
            if (error instanceof ProtocolError && error.code === 'content_unavailable')
                throw new PeerError('not_found', error.message);
            throw as_write_refusal(error);
        }
        return library_track(context, { address: target.address, track_id });
    },
    // A content.tags correction (§2.4.3): a new content object for the same
    // audio, PUT under the same id.
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
            await append_write(context, target, build_del_operation({ key: track_id }));
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
    list_tags: async ({ library_addresses, label_libraries, prefix, managed_libraries }) => list_tags({
        db: context.db,
        library_addresses: library_addresses ?? visible_addresses(context),
        label_libraries: label_libraries ?? default_label_libraries(context, library_addresses),
        prefix,
        managed_libraries
    }),
    add_tag: async ({ track_id, tag, library_address, capability_id }) => await write_label_change(context, { track_id, change: { add: [tag] }, library_address, capability_id }),
    remove_tag: async ({ track_id, tag, library_address, capability_id }) => await write_label_change(context, { track_id, change: { remove: [tag] }, library_address, capability_id }),
    change_labels: async ({ track_id, add, remove, set, library_address, capability_id }) => await write_label_change(context, { track_id, change: { add, remove, set }, library_address, capability_id }),
    // Every item is checked before any applies, so a malformed one fails the batch.
    change_labels_batch: async ({ items, library_address, capability_id }) => {
        const checked = items.map(({ track_id, ...change }) => ({ track_id: checked_track_id(track_id), change: checked_label_change(change) }));
        return await write_labels(context, { items: checked, library_address, capability_id });
    },
    list_library_labels: async ({ address, offset, limit }) => {
        if (context.libraries.get(address) === undefined)
            throw new PeerError('not_found', `library not open: ${address}`);
        return { library_address: address, ...list_library_labels({ db: context.db, library_address: address, offset, limit }) };
    },
    get_audio: async (cid) => await context.audio.read(cid),
    has_audio: async (cid) => await context.audio.read_local(cid) !== undefined,
    get_image: async (cid, { local_only = false } = {}) => local_only ? await context.images.read_local(cid) : await context.images.read(cid)
});
