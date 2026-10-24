// Network message bodies (§5.3.2, §5.4.1) as JSON codecs with the 256 KiB
// bound: encoders never produce a larger message, and decoders drop one
// before parsing it. Publishing and coalescing belong to the replication engine.
import { parse_library_address } from '#encoding/library-address.ts';
import { is_cid_string } from '#encoding/cid.ts';
import { is_record } from '#types/guards.ts';
// §5.3.2 and §5.4.1: after JSON encoding.
export const NETWORK_MESSAGE_MAX_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const byte_length = (json) => encoder.encode(json).length;
// Oversized or unparseable bytes are dropped without processing.
const parse_bounded = (data) => {
    if (data.length > NETWORK_MESSAGE_MAX_BYTES)
        return undefined;
    try {
        return JSON.parse(decoder.decode(data));
    }
    catch {
        return undefined;
    }
};
export const encode_heads_message = ({ heads, incomplete = false }) => JSON.stringify(incomplete ? { type: 'heads', heads, incomplete: true } : { type: 'heads', heads });
// One trigger's heads as messages within the bound (§5.4.1): every message but
// the last carries incomplete: true. An empty set is one empty message.
export const encode_heads_batches = ({ heads, max_bytes = NETWORK_MESSAGE_MAX_BYTES }) => {
    const overhead = byte_length(encode_heads_message({ heads: [], incomplete: true }));
    const batches = [[]];
    let size = overhead;
    for (const head of heads) {
        const batch = batches[batches.length - 1];
        const added = byte_length(JSON.stringify(head)) + (batch.length > 0 ? 1 : 0);
        if (batch.length > 0 && size + added > max_bytes) {
            batches.push([head]);
            size = overhead + added - 1;
        }
        else {
            batch.push(head);
            size += added;
        }
    }
    return batches.map((batch, index) => encoder.encode(encode_heads_message({ heads: batch, incomplete: index < batches.length - 1 })));
};
// A heads message whose every element is a CID string, or undefined.
export const decode_heads_message = (data) => {
    const value = parse_bounded(data);
    if (!is_record(value) || value.type !== 'heads' || !Array.isArray(value.heads))
        return undefined;
    if (!value.heads.every(is_cid_string))
        return undefined;
    return { heads: value.heads, incomplete: value.incomplete === true };
};
// A signed entry as an announcement carries it (§5.3.2): the §4.1.1 object
// as JSON, in its field order, with no hash. A receiver re-encodes it to
// recover the hash and the signed message.
export const announced_entry = ({ id, payload, next, refs, v, clock, key, sig }) => ({ id, payload, next, refs, v, clock, key, sig });
const message_of = ({ libraries, profiles }) => JSON.stringify({
    libraries: libraries.map(({ address, about }) => about === undefined ? { address } : { address, about }),
    profiles
});
// The announcement within the bound (§5.3.2): the first own_count libraries
// are kept, and libraries after them are left out from the end, each with
// the profile of an owner no kept library names, until the message fits.
// owners gives each library's single write-list key, when it has one.
// Undefined when even the own libraries do not fit.
export const encode_announcement = ({ libraries, profiles, own_count = libraries.length, owners = new Map() }) => {
    const kept = [...libraries];
    for (;;) {
        const keys = new Set(kept.flatMap(({ address }) => owners.get(address) ?? []));
        const bytes = encoder.encode(message_of({ libraries: kept, profiles: owners.size === 0 ? profiles : profiles.filter(({ key }) => keys.has(key)) }));
        if (bytes.length <= NETWORK_MESSAGE_MAX_BYTES)
            return bytes;
        if (kept.length <= own_count)
            return undefined;
        kept.pop();
    }
};
// A map shaped as a signed entry; its fields are checked when it is verified.
const entry_like = (value) => is_record(value) && is_record(value.payload) && typeof value.id === 'string' && typeof value.key === 'string' ? value : undefined;
const announced_library = (value) => {
    if (!is_record(value) || typeof value.address !== 'string')
        return undefined;
    try {
        parse_library_address(value.address);
    }
    catch {
        return undefined;
    }
    const about = entry_like(value.about);
    return about === undefined ? { address: value.address } : { address: value.address, about };
};
// §5.3.4 steps 1 and 2: parse, keep each library whose address is a valid
// library address, and each profile shaped as a signed entry. The entries
// are untrusted until verified. Undefined drops the message.
export const decode_announcement = (data) => {
    const value = parse_bounded(data);
    if (!is_record(value) || !Array.isArray(value.libraries))
        return undefined;
    return {
        libraries: value.libraries.flatMap((library) => announced_library(library) ?? []),
        profiles: Array.isArray(value.profiles) ? value.profiles.flatMap((profile) => entry_like(profile) ?? []) : []
    };
};
