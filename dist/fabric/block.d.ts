import { importer } from 'ipfs-unixfs-importer';
import { CID } from 'multiformats/cid';
import { type BlobSource } from './content-store.ts';
export declare const parse_content_cid: (cid_string: string) => CID;
export declare const format_cid: (cid: CID) => string;
export declare const verify_block: ({ cid, bytes }: {
    cid: CID;
    bytes: Uint8Array;
}) => void;
export declare const walk_blocks: ({ cid, recursive, read }: {
    cid: CID;
    recursive: boolean;
    read: (cid: CID) => Promise<Uint8Array | undefined>;
}) => Promise<CID[]>;
export declare const collect_bytes: (source: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => Promise<Uint8Array>;
type BlockSink = Parameters<typeof importer>[1];
export declare const import_unixfs_file: ({ source, put }: {
    source: BlobSource;
    put: (cid: Parameters<BlockSink["put"]>[0], bytes: Uint8Array) => Promise<void>;
}) => Promise<string>;
export {};
