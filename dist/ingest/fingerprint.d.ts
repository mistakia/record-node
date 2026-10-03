import type { Toolchain } from './toolchain.ts';
export declare const FPCALC_ARGS: readonly ["-json", "-algorithm", "2"];
export declare const compute_fingerprint: ({ file_path, toolchain }: {
    file_path: string;
    toolchain: Toolchain;
}) => Promise<string>;
export declare const decode_fingerprint: (fingerprint: string) => {
    algorithm: number;
    values: number[];
};
export declare const is_degenerate_fingerprint: (fingerprint: string) => boolean;
