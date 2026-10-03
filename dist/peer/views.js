// Query rows to the API shapes of 7-http-api.yaml (src/types/peer.ts).
import { compute_log_id } from '#entry/id.ts';
// The query index keeps duration_seconds; the API ResolverEntry is §2.4.2's
// own shape, with duration.
const to_resolver_entry = ({ duration_seconds, ...rest }) => duration_seconds === undefined ? { ...rest } : { ...rest, duration: duration_seconds };
// A track whose content payload is not stored yet has no audio CID, and the
// API Track requires one, so it is left out.
export const to_api_track = (row) => {
    if (row.audio_cid === null || row.audio_size_bytes === null)
        return undefined;
    const { library_address: _library_address, resolvers, audio_cid, audio_size_bytes, ...rest } = row;
    return { ...rest, audio_cid, audio_size_bytes, resolvers: resolvers.map(to_resolver_entry) };
};
export const to_api_tracks = (rows) => rows.flatMap((row) => to_api_track(row) ?? []);
export const to_api_about = (row) => ({ ...row });
export const to_api_library = ({ address, summary, about, alias, is_own, is_linked, is_loading, replication }) => ({
    id: compute_log_id(address),
    address,
    name: about?.name ?? null,
    bio: about?.bio ?? null,
    location: about?.location ?? null,
    avatar: about?.avatar ?? null,
    alias,
    ...summary,
    replication_status: replication.status,
    is_replicating: replication.is_replicating,
    is_loading_index: is_loading,
    is_processing_index: false,
    is_linked,
    is_own,
    peer_ids: replication.peer_ids
});
