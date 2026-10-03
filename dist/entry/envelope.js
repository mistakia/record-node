// Record-entry envelopes (§2.2, §2.4.3).
import { is_protocol_cid } from '#encoding/cid.ts';
import { assert_envelope_tags } from '#encoding/size-bounds.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
const ENVELOPE_TYPES = ['track', 'log', 'about'];
const ENVELOPE_ID_PATTERN = /^[0-9a-f]{64}$/;
const invalid = (message) => new ProtocolError('invalid_shape', message);
const is_envelope_type = (value) => ENVELOPE_TYPES.includes(value);
// Validates a received envelope and returns its read view. Unknown extras are
// ignored: they are not copied into the view, so nothing indexes or forwards
// them (§2.2). Track tags are bounded here, before any signature check (§2.8.3).
export const validate_envelope = (value) => {
    if (!is_record(value))
        throw invalid('an envelope must be a map');
    const { id, timestamp, v, type, content, tags } = value;
    if (typeof id !== 'string' || !ENVELOPE_ID_PATTERN.test(id))
        throw invalid('envelope id must be 64 lowercase hex chars');
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
        throw invalid('envelope timestamp must be unsigned integer milliseconds');
    if (v !== 1)
        throw invalid('envelope v must be 1');
    if (!is_envelope_type(type))
        throw invalid(`envelope type must be one of ${ENVELOPE_TYPES.join(', ')}`);
    if (!is_protocol_cid(content))
        throw invalid('envelope content must be a base58btc dag-cbor sha3-512 CID');
    const view = { id, timestamp: timestamp, v: 1, type, content };
    if (type !== 'track' || tags === undefined)
        return view;
    return { ...view, tags: assert_envelope_tags(tags) };
};
// Writers emit exactly the §2.2 fields, plus tags on a track and nothing else.
// The timestamp defaults to now, in milliseconds since the Unix epoch.
const build_envelope = ({ type, id, content_cid, timestamp = Date.now(), tags }) => {
    const envelope = { id, timestamp, v: 1, type, content: content_cid };
    return Object.freeze(validate_envelope(tags === undefined ? envelope : { ...envelope, tags: [...tags] }));
};
export const build_track_envelope = (input) => build_envelope({ ...input, type: 'track' });
export const build_log_envelope = (input) => build_envelope({ ...input, type: 'log' });
export const build_about_envelope = (input) => build_envelope({ ...input, type: 'about' });
