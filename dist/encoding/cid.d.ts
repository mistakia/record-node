import { CID } from 'multiformats/cid';
import type { CanonicalBytes } from './canonical-bytes.ts';
export declare const SHA3_512_CODE = 20;
export declare const compute_cid: (bytes: CanonicalBytes) => CID;
export declare const compute_cid_string: (bytes: CanonicalBytes) => string;
export declare const parse_cid: (cid_string: string) => CID;
export declare const is_protocol_cid: (value: unknown) => value is string;
export declare const is_cid_string: (value: unknown) => value is string;
