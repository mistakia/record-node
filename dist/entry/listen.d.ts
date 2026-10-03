import type { ListenPayload } from '#types/entry.ts';
export declare const validate_listen_payload: (value: unknown) => ListenPayload;
export declare const build_listen_payload: ({ track_id, address, timestamp }: {
    track_id: string;
    address: string;
    timestamp?: number;
}) => ListenPayload;
