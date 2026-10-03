// Envelope id derivation (§2.3, §6.1.4): plain lowercase sha256 hex.
import { sha256_hex } from '#encoding/sha256.ts';
import { ProtocolError } from '#types/errors.ts';
// Hashes the fpcalc fingerprint string itself, not its decoded bytes. An
// empty fingerprint is refused so sha256("") never stands in as a track id.
export const compute_track_id = (fingerprint) => {
    if (fingerprint.length === 0) {
        throw new ProtocolError('invalid_fingerprint', 'an empty fingerprint has no track id');
    }
    return sha256_hex(fingerprint);
};
// Log and about ids hash the exact address string, /record/ prefix and
// /<name> suffix included; the envelope type tells them apart.
export const compute_log_id = (library_address) => sha256_hex(library_address);
export const compute_about_id = (library_address) => sha256_hex(library_address);
