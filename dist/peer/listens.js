// The listens library (§2.7, §6.5). A listen is a bare {trackId, address,
// timestamp, clientListenId?} write; the payload builder refuses a missing
// trackId, and the listens library's operation check refuses DEL on append
// and on merge.
import { build_listen_payload } from '#entry/listen.ts';
export const LISTENS_LIBRARY_NAME = 'listens';
export const record_listen = async ({ libraries, listens_address, key_pair, track_id, address, timestamp, client_listen_id }) => {
    const payload = build_listen_payload({
        track_id,
        address,
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(client_listen_id === undefined ? {} : { client_listen_id })
    });
    return await libraries.append({ library_address: listens_address, payload, key_pair });
};
