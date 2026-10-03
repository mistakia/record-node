import { type LookupFunction } from 'node:net';
export type Download = (input: {
    url: string;
    headers?: Readonly<Record<string, string>> | undefined;
    output_path: string;
}) => Promise<void>;
export declare const create_download: ({ lookup }?: {
    lookup?: LookupFunction;
}) => Download;
export declare const download_to_file: Download;
