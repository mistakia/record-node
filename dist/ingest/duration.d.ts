import type { Toolchain } from './toolchain.ts';
export declare const decode_args: (file_path: string) => string[];
export declare const decoded_duration: ({ file_path, toolchain }: {
    file_path: string;
    toolchain: Toolchain;
}) => Promise<number>;
