export declare const validate_library_name: (name: string) => string;
export declare const build_library_address: ({ manifest_cid, name }: {
    manifest_cid: string;
    name: string;
}) => string;
export declare const parse_library_address: (address: string) => {
    manifest_cid: string;
    name: string;
};
export declare const is_library_address: (value: unknown) => value is string;
