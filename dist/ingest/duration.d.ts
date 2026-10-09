import type { Toolchain } from './toolchain.ts';
export interface DecodedAudio {
    readonly samples: number;
    readonly rate: number;
}
export interface DecodedFields {
    readonly duration: number;
    readonly numberOfSamples: number;
    readonly bitrate: number;
}
export declare const decode_args: (file_path: string) => string[];
export declare const decode_audio: ({ file_path, toolchain }: {
    file_path: string;
    toolchain: Toolchain;
}) => Promise<DecodedAudio>;
export declare const decoded_seconds: ({ samples, rate }: DecodedAudio) => number;
export declare const decoded_fields: (decoded: DecodedAudio, size: number) => DecodedFields;
