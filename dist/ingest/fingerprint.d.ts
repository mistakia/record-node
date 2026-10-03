import type { Toolchain } from './toolchain.ts';
export declare const FPCALC_ARGS: readonly ["-json", "-algorithm", "2"];
export declare const compute_fingerprint: ({ file_path, toolchain }: {
    file_path: string;
    toolchain: Toolchain;
}) => Promise<string>;
