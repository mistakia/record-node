// Query rows to the API shapes of 7-http-api.yaml (src/types/peer.ts).
import { compute_log_id } from '#entry/id.ts';
import { canonical_cid } from '#entry/identity-record.ts';
// The query index keeps duration_seconds; the API ResolverEntry is §2.4.2's
// own shape, with duration.
const to_resolver_entry = ({ duration_seconds, ...rest }) => duration_seconds === undefined ? { ...rest } : { ...rest, duration: duration_seconds };
// A track whose content payload is not stored yet has no audio CID, and the
// API Track requires one, so it is left out. pins holds the canonical CIDs
// the identity library pins (§4.6.2).
export const to_api_track = (row, pins) => {
    if (row.audio_cid === null || row.audio_size_bytes === null)
        return undefined;
    const { library_address: _library_address, resolvers, audio_cid, audio_size_bytes, ...rest } = row;
    const is_pinned = pins.size > 0 && pins.has(canonical_cid(audio_cid));
    return { ...rest, audio_cid, audio_size_bytes, is_pinned, resolvers: resolvers.map(to_resolver_entry) };
};
export const to_api_tracks = (rows, pins) => rows.flatMap((row) => to_api_track(row, pins) ?? []);
export const to_api_about = (row) => ({ ...row });
export const to_api_library = ({ address, library_type, heads, summary, about, alias, is_own, is_retired, is_linked, held_capability_ids, replication_mode, is_loading, replication }) => ({
    id: compute_log_id(address),
    address,
    library_type,
    name: about?.name ?? null,
    bio: about?.bio ?? null,
    location: about?.location ?? null,
    avatar: about?.avatar ?? null,
    alias,
    ...summary,
    heads: [...heads],
    replication_status: replication.status,
    is_replicating: replication.is_replicating,
    connected: replication.connected,
    is_loading_index: is_loading,
    is_processing_index: false,
    is_linked,
    is_own,
    is_retired,
    held_capability_ids,
    replication_mode,
    peer_ids: replication.peer_ids
});
