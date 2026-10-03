import { type KeyPair } from '#identity/key-pair.ts';
export declare const marshal_private_key: (key_pair: KeyPair) => string;
export declare const marshal_public_key: (key_pair: KeyPair) => string;
export declare const unmarshal_private_key: (hex: string) => KeyPair;
export declare const peer_id_of: (key_pair: KeyPair) => string;
export declare const identity_id_of: (key_pair: KeyPair) => string;
export declare const save_key_pair: ({ path, key_pair }: {
    path: string;
    key_pair: KeyPair;
}) => Promise<void>;
export declare const load_key_pair: ({ path }: {
    path: string | undefined;
}) => Promise<KeyPair>;
