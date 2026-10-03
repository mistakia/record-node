// Replication policy (§4.6.1): node-local configuration deciding item 6, the
// audio and artwork of each live Track entry, for a linked library. An own
// library is always full. A link recorded in the identity library defaults to
// full, and one carried over from a v1.0 Log entry to index_only.
import { filter_matches, filter_shape } from '#access-control/filter.ts';
import { is_put } from '#entry/operations.ts';
import { PeerError } from '#types/peer.ts';
import { find_own_library, link_set } from "./ownership.js";
// The policy a library replicates under, or undefined for one that is
// neither own nor linked.
export const effective_policy = (context, address) => {
    if (find_own_library(context, address) !== undefined)
        return { mode: 'full', filter: null };
    const link = link_set(context).find((candidate) => candidate.address === address);
    if (link === undefined)
        return undefined;
    const stored = context.policies.get(address);
    if (stored !== undefined)
        return { mode: stored.mode, filter: stored.mode === 'selective' ? (stored.filter ?? null) : null };
    return { mode: link.source === 'identity' ? 'full' : 'index_only', filter: null };
};
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
// The object a selective filter reads for one live Track entry (§4.6.1). A
// field whose source is absent or null is left out.
export const track_view = ({ library_address, entry, content }) => {
    const envelope = is_put(entry.operation) ? entry.operation.value : undefined;
    const tags = (content.tags ?? {});
    const audio = (content.audio ?? {});
    const view = {
        library_address,
        added_by: entry.entry.key,
        added_at: envelope?.timestamp,
        tags: [...envelope?.tags ?? []],
        cid: content.hash,
        audio_size_bytes: content.size,
        duration_seconds: audio.duration,
        title: tags.title,
        artist: tags.artist,
        source: (Array.isArray(content.resolver) ? content.resolver : []).flatMap(({ extractor }) => strings([extractor]))
    };
    return Object.fromEntries(Object.entries(view).filter(([, value]) => value !== undefined && value !== null));
};
// The pin predicate the library manager applies to each Track entry. Before
// the identity opens, and for the identity library itself, everything keeps.
export const keeps_blobs = (context) => (library_address) => {
    if (context.identity === undefined || library_address === context.identity.identity_address)
        return () => true;
    const policy = effective_policy(context, library_address);
    if (policy === undefined || policy.mode === 'index_only')
        return () => false;
    if (policy.mode === 'full')
        return () => true;
    return ({ entry, content }) => filter_matches(policy.filter ?? { type: 'unknown' }, track_view({ library_address, entry, content }));
};
const connected = (context, address) => context.replication?.get(address)?.state() !== 'paused';
export const get_replication_policy = (context, address) => {
    const policy = effective_policy(context, address);
    if (policy === undefined)
        throw new PeerError('not_found', `neither an own nor a linked library: ${address}`);
    return { ...policy, connected: connected(context, address) };
};
// A filter the node cannot evaluate is refused (§3.5.7), so a stored
// selective policy always selects by a filter the node understands.
export const validate_policy = ({ mode, filter }) => {
    if (mode !== 'selective')
        return { mode };
    if (filter === undefined || filter === null)
        throw new PeerError('invalid', 'a selective policy requires a filter');
    const shape = filter_shape(filter);
    if (shape !== 'ok')
        throw new PeerError('invalid', `the filter is ${shape === 'unknown' ? 'of a type this node does not recognise' : 'malformed'} (§3.5.7)`);
    return { mode, filter: filter };
};
