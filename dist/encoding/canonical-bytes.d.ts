declare const canonical_bytes_brand: unique symbol;
export type CanonicalBytes = Uint8Array & {
    readonly [canonical_bytes_brand]: true;
};
export declare const encode_canonical: (value: unknown) => CanonicalBytes;
export declare const decode_canonical: (bytes: Uint8Array) => {
    value: unknown;
    bytes: CanonicalBytes;
};
export {};
