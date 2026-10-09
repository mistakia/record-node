export declare const read_unixfs_file: ({ cid, read, max_bytes }: {
    cid: string;
    read: (cid: string) => Promise<Uint8Array | undefined>;
    max_bytes?: number;
}) => Promise<Uint8Array | undefined>;
