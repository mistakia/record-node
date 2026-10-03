import type { Toolchain } from './toolchain.ts';
export declare const STRIP_ARGS: readonly ["-map", "0:a", "-codec:a", "copy", "-bitexact", "-map_metadata", "-1"];
export declare const probe_stream_kinds: ({ file_path, toolchain }: {
    file_path: string;
    toolchain: Toolchain;
}) => Promise<string[]>;
export declare const strip_tags: ({ input_path, output_path, toolchain }: {
    input_path: string;
    output_path: string;
    toolchain: Toolchain;
}) => Promise<void>;
