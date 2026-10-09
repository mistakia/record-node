import { type DecodedFields } from './duration.ts';
import type { Toolchain } from './toolchain.ts';
export declare const blob_decoded_fields: ({ blob, size, toolchain }: {
    blob: Uint8Array;
    size: number;
    toolchain: Toolchain;
}) => Promise<DecodedFields>;
export declare const with_decoded_fields: (content: Readonly<Record<string, unknown>>, fields: DecodedFields) => Record<string, unknown> | undefined;
