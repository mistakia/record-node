import type { VerifiedEntry } from '#oplog/accept.ts';
import type { PeerContext } from './context.ts';
export interface ContentFetcher {
    fetch: (input: {
        library_address: string;
        entries: readonly VerifiedEntry[];
    }) => void;
    retry_missing: (library_address: string) => void;
    forget: (library_address: string) => void;
    settled: (library_address: string) => Promise<void>;
}
export declare const create_content_fetcher: ({ context, get_block }: {
    context: PeerContext;
    get_block: (cid: string) => Promise<Uint8Array | undefined>;
}) => ContentFetcher;
