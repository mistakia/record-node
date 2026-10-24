// Size bounds enforced at deserialization, before any signature check (§2.8.3).
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { ProtocolError } from '#types/errors.ts';
export const SIGNED_ENTRY_MAX_BYTES = 256 * 1024;
export const PAYLOAD_MAX_BYTES = 1024 * 1024;
export const LABEL_MAX_BYTES = 128;
const assert_max = ({ size, max, label }) => {
    if (size > max)
        throw new ProtocolError('size_exceeded', `${label} is ${size} bytes, over the ${max}-byte bound`);
};
export const assert_signed_entry_size = (bytes) => assert_max({ size: bytes.length, max: SIGNED_ENTRY_MAX_BYTES, label: 'signed entry' });
export const assert_payload_size = (bytes) => assert_max({ size: bytes.length, max: PAYLOAD_MAX_BYTES, label: 'envelope payload' });
// General category Cc: C0 controls, DEL, and C1 controls.
const CONTROL_CHARACTER = /\p{Cc}/u;
// §2.5: a label is a string in NFC of 1 to 128 UTF-8 bytes with no control
// character. The byte bound is a size bound; the rest is shape.
export const assert_label = (label) => {
    if (typeof label !== 'string' || label.length === 0)
        throw new ProtocolError('invalid_shape', 'a label must be a non-empty string');
    if (label.normalize('NFC') !== label)
        throw new ProtocolError('invalid_shape', 'a label must be in Unicode Normalization Form C');
    if (CONTROL_CHARACTER.test(label))
        throw new ProtocolError('invalid_shape', 'a label must not contain a control character');
    assert_max({ size: utf8ToBytes(label).length, max: LABEL_MAX_BYTES, label: 'label' });
    return label;
};
