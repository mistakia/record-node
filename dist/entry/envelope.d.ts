import type { Envelope, EnvelopeType } from '#types/entry.ts';
export declare const ENVELOPE_TYPES: readonly EnvelopeType[];
export declare const validate_envelope: (value: unknown) => Envelope;
type EnvelopeInput = {
    id: string;
    content_cid: string;
    timestamp?: number;
};
export declare const build_track_envelope: (input: EnvelopeInput & {
    tags?: readonly string[];
}) => Envelope;
export declare const build_log_envelope: (input: EnvelopeInput) => Envelope;
export declare const build_about_envelope: (input: EnvelopeInput) => Envelope;
export {};
