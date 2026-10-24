// Track envelopes (§2.2).
import { is_protocol_cid } from '#encoding/cid.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
const ENVELOPE_ID_PATTERN = /^[0-9a-f]{64}$/;
const invalid = (message) => new ProtocolError('invalid_shape', message);
// Validates a received envelope and returns its read view. Unknown extras,
// such as a v1 envelope's tags, are ignored: they are not copied into the
// view, so nothing indexes or forwards them (§2.2).
export const validate_envelope = (value) => {
    if (!is_record(value))
        throw invalid('an envelope must be a map');
    const { id, timestamp, v, type, content } = value;
    if (typeof id !== 'string' || !ENVELOPE_ID_PATTERN.test(id))
        throw invalid('envelope id must be 64 lowercase hex chars');
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
        throw invalid('envelope timestamp must be unsigned integer milliseconds');
    if (v !== 1)
        throw invalid('envelope v must be 1');
    if (type !== 'track')
        throw invalid('envelope type must be track');
    if (!is_protocol_cid(content))
        throw invalid('envelope content must be a base58btc dag-cbor sha3-512 CID');
    return { id, timestamp: timestamp, v: 1, type, content };
};
// Writers emit exactly the §2.2 fields and no extras. The timestamp defaults
// to now, in milliseconds since the Unix epoch.
export const build_track_envelope = ({ id, content_cid, timestamp = Date.now() }) => Object.freeze(validate_envelope({ id, timestamp, v: 1, type: 'track', content: content_cid }));
