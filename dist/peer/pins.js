// What a library pins (§3.5.1, §4.6): the three AC chain objects, and per
// entry the signed entry block, the envelope content payload, and item 6
// when the library's replication policy keeps it (§4.6.1): a track's audio
// blob and artwork, or in an identity library the avatar of a profile.
// Items 1-5 are dag-cbor leaves and pinned directly; item 6 is a UnixFS DAG
// and pinned recursively.
import { is_identity_operation, is_put } from '#entry/operations.ts';
import { decode_payload, validate_track_content } from '#entry/payload.ts';
import { ProtocolError } from '#types/errors.ts';
export const chain_pins = (chain) => [chain.cids.manifest, chain.cids.wrapper, chain.cids.write_list].map((cid) => [cid, false]);
// A content payload validated, or undefined when it is not stored or does
// not validate.
const stored_content = async ({ content_store, content_cid, validate }) => {
    const bytes = await content_store.get(content_cid);
    if (bytes === undefined)
        return undefined;
    try {
        return validate(decode_payload(bytes));
    }
    catch (error) {
        if (error instanceof ProtocolError)
            return undefined;
        throw error;
    }
};
export const stored_track_content = async ({ content_store, content_cid }) => await stored_content({ content_store, content_cid, validate: validate_track_content });
export const track_blobs = (content) => [content.hash, ...content.artwork];
// The avatar a profile PUT names (§4.6 item 6, §4.8.2).
const profile_avatar = (entry) => {
    const { operation } = entry;
    return is_identity_operation(operation) && operation.op === 'PUT' && operation.value.type === 'profile' ? operation.value.avatar : undefined;
};
// Whether an entry can carry item 6: a track PUT, or a profile PUT with an avatar.
export const has_item_6 = (entry) => is_put(entry.operation) || profile_avatar(entry) !== undefined;
// An entry's item 6 with what names it, the validated track content or the
// profile record, or undefined when the entry carries none or its payload
// is not stored or does not validate.
export const stored_item_6 = async ({ content_store, entry }) => {
    const avatar = profile_avatar(entry);
    if (avatar !== undefined)
        return { content: entry.operation.value, blobs: [avatar] };
    if (!is_put(entry.operation))
        return undefined;
    const content = await stored_track_content({ content_store, content_cid: entry.operation.value.content });
    return content === undefined ? undefined : { content, blobs: track_blobs(content) };
};
// A payload not stored yet contributes no item-6 pins; they follow once the
// payload arrives and the entry is pinned again.
export const entry_pins = async ({ content_store, library_address, entry, keeps_blobs }) => {
    const pins = [[entry.hash, false]];
    if (is_put(entry.operation))
        pins.push([entry.operation.value.content, false]);
    else if (!has_item_6(entry))
        return pins;
    const item = await stored_item_6({ content_store, library_address, entry });
    if (item !== undefined && keeps_blobs({ entry, content: item.content }))
        pins.push(...item.blobs.map((cid) => [cid, true]));
    return pins;
};
// Pins each CID the store holds and records it in the set, returning the
// pins it added. A CID whose blocks are not all local yet is left out, so the
// set holds only real pins.
export const pin_into = async ({ content_store, pins, items }) => {
    const added = [];
    for (const [cid, recursive] of items) {
        if (pins.get(cid) === true || pins.get(cid) === recursive)
            continue;
        try {
            await content_store.pin(cid, { recursive });
            pins.set(cid, recursive);
            added.push([cid, recursive]);
        }
        catch (error) {
            if (!(error instanceof ProtocolError && error.code === 'content_unavailable'))
                throw error;
        }
    }
    return added;
};
