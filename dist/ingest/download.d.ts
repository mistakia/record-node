export type Download = (input: {
    url: string;
    headers?: Readonly<Record<string, string>> | undefined;
    output_path: string;
}) => Promise<void>;
export declare const download_to_file: Download;
