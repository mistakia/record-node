// sha3-512 for protocol-object CIDs (§2.1), through node:crypto when the
// runtime has it. Node's OpenSSL hashes an entry about 16 times faster than
// the pure-JS implementation, which dominated decoding a large library's
// entries at open; Electron's BoringSSL has no sha3, so it keeps noble's.
import { createHash, getHashes } from 'node:crypto';
import { sha3_512 as noble_sha3_512 } from '@noble/hashes/sha3.js';
export const sha3_512 = getHashes().includes('sha3-512')
    ? (bytes) => new Uint8Array(createHash('sha3-512').update(bytes).digest())
    : noble_sha3_512;
