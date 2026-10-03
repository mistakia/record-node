export declare const PINNED_FFMPEG_VERSION = "7.1.1";
export declare const PINNED_FPCALC_VERSION = "1.5.1";
declare const verified_toolchain_brand: unique symbol;
export type Toolchain = {
    readonly ffmpeg_path: string;
    readonly fpcalc_path: string;
    readonly ffmpeg_version: string;
    readonly fpcalc_version: string;
    readonly [verified_toolchain_brand]: true;
};
export declare const is_pinned_toolchain: (toolchain: Toolchain) => boolean;
export declare const verify_toolchain: ({ ffmpeg_path, fpcalc_path, allow_version_mismatch }?: {
    ffmpeg_path?: string;
    fpcalc_path?: string;
    allow_version_mismatch?: boolean;
}) => Promise<Toolchain>;
export {};
