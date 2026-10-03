// Library address /record/<manifest-cid>/<name> (§3.6) and name charset (§3.7).
// Addresses are opaque strings for transport and comparison; parsing exists
// only to reach the manifest CID and name during AC chain resolution. Loading
// accepts any CID in the manifest slot (§3.7); creation always writes a §2.1 one.
import { ProtocolError } from '#types/errors.ts';
import { is_cid_string } from "./cid.js";
const ADDRESS_PREFIX = '/record/';
const LIBRARY_NAME_PATTERN = /^[0-9a-zA-Z-]*$/;
export const validate_library_name = (name) => {
    if (!LIBRARY_NAME_PATTERN.test(name)) {
        throw new ProtocolError('invalid_library_name', `library name must match ${LIBRARY_NAME_PATTERN}: ${name}`);
    }
    return name;
};
export const build_library_address = ({ manifest_cid, name }) => `${ADDRESS_PREFIX}${manifest_cid}/${name}`;
export const parse_library_address = (address) => {
    const rest = address.startsWith(ADDRESS_PREFIX) ? address.slice(ADDRESS_PREFIX.length) : undefined;
    const separator = rest?.indexOf('/') ?? -1;
    if (rest === undefined || separator < 0) {
        throw new ProtocolError('invalid_library_address', `not a /record/<manifest-cid>/<name> address: ${address}`);
    }
    const manifest_cid = rest.slice(0, separator);
    const name = rest.slice(separator + 1);
    if (!is_cid_string(manifest_cid)) {
        throw new ProtocolError('invalid_library_address', `address manifest is not a CID: ${address}`);
    }
    if (name.includes('/')) {
        throw new ProtocolError('invalid_library_address', `address name contains a separator: ${address}`);
    }
    return { manifest_cid, name };
};
export const is_library_address = (value) => {
    if (typeof value !== 'string')
        return false;
    try {
        parse_library_address(value);
        return true;
    }
    catch {
        return false;
    }
};
