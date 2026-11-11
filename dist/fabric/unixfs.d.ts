type BlockRead = (cid: string) => Promise<Uint8Array | undefined>;
export interface UnixFsFile {
    readonly file_size: number;
    read_range: (range: {
        start_offset: number;
        end_offset: number;
    }) => AsyncIterable<Uint8Array>;
}
export declare const open_unixfs_file: ({ cid, read, max_bytes }: {
    cid: string;
    read: BlockRead;
    max_bytes?: number | undefined;
}) => Promise<UnixFsFile | undefined>;
export declare const read_unixfs_file: ({ cid, read, max_bytes }: {
    cid: string;
    read: BlockRead;
    max_bytes?: number;
}) => Promise<Uint8Array | undefined>;
export declare const visit_unixfs_file: ({ cid, read }: {
    cid: string;
    read: BlockRead;
}) => Promise<boolean>;
export declare const has_unixfs_file: ({ cid, read, has }: {
    cid: string;
    read: BlockRead;
    has: (cid: string) => Promise<boolean>;
}) => Promise<boolean>;
export {};
