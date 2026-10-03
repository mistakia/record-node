export declare const read_unixfs_file: ({ cid, read }: {
    cid: string;
    read: (cid: string) => Promise<Uint8Array | undefined>;
}) => Promise<Uint8Array | undefined>;
