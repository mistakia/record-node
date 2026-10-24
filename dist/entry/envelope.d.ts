import type { Envelope } from '#types/entry.ts';
export declare const validate_envelope: (value: unknown) => Envelope;
export declare const build_track_envelope: ({ id, content_cid, timestamp }: {
    id: string;
    content_cid: string;
    timestamp?: number | undefined;
}) => Envelope;
