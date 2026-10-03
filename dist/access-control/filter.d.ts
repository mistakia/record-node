export type Shape = 'ok' | 'unknown' | 'malformed';
export declare const MAX_SPEC_DEPTH = 16;
export declare const worst_shape: (...shapes: Shape[]) => Shape;
export declare const has_extra_fields: (node: Record<string, unknown>, fields: readonly string[]) => boolean;
export declare const filter_shape: (node: unknown, depth?: number) => Shape;
export declare const filter_matches: (filter: unknown, subject: unknown) => boolean;
