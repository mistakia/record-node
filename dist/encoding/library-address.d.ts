import type { LibraryType } from '#types/library.ts';
import { type CanonicalBytes } from './canonical-bytes.ts';
export declare const IDENTITY_LIBRARY_NAME = "identity";
export declare const validate_library_name: (name: string) => string;
export declare const validate_discriminator: (name: string) => string;
export declare const build_library_address: ({ manifest_cid, name }: {
    manifest_cid: string;
    name: string;
}) => string;
export interface AcChainObject {
    readonly cid: string;
    readonly bytes: CanonicalBytes;
}
export declare const build_ac_chain: ({ name, type, write_keys }: {
    name: string;
    type: LibraryType;
    write_keys: readonly string[];
}) => {
    address: string;
    write_list: AcChainObject;
    wrapper: AcChainObject;
    manifest: AcChainObject;
};
export declare const derive_library_address: ({ key, type, discriminator }: {
    key: string;
    type: LibraryType;
    discriminator: string;
}) => string;
export declare const identity_library_address: (key: string) => string;
export declare const parse_library_address: (address: string) => {
    manifest_cid: string;
    name: string;
};
export declare const is_library_address: (value: unknown) => value is string;
