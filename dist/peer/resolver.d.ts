import { type ResolvedEntry } from 'record-resolver';
import { type Resolver } from '#types/peer.ts';
export type ResolveUrl = (url: string) => Promise<readonly ResolvedEntry[]>;
export declare const create_resolver: ({ ytdlp_path }?: {
    ytdlp_path?: string | undefined;
}) => ResolveUrl;
export declare const refuse_input_errors: (resolve: ResolveUrl) => ResolveUrl;
export declare const as_api_resolver: (resolve: ResolveUrl) => Resolver;
