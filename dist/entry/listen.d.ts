import type { ListenPayload } from '#types/entry.ts';
export declare const CLIENT_LISTEN_ID_PATTERN: RegExp;
export declare const validate_listen_payload: (value: unknown) => ListenPayload;
export declare const build_listen_payload: ({ track_id, address, timestamp, client_listen_id }: {
    track_id: string;
    address: string;
    timestamp?: number;
    client_listen_id?: string;
}) => ListenPayload;
