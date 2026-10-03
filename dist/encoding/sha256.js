// sha256 of a UTF-8 string as lowercase hex, no prefix or separators (§2.3.1).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
export const sha256_hex = (text) => bytesToHex(sha256(utf8ToBytes(text)));
