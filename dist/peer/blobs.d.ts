import type { Network } from '#fabric/network.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import type { Timers } from '#replication/timers.ts';
import type { PeerContext } from './context.ts';
export interface BlobKeeper {
    entries: (library_address: string, entries: readonly VerifiedEntry[]) => Promise<void>;
    policy_changed: (library_address: string) => Promise<void>;
    sync_pins: (pins: ReadonlySet<string>) => Promise<void>;
    retained: () => ReadonlySet<string>;
    retry: () => void;
    settled: () => Promise<void>;
    stop: () => void;
}
export declare const create_blob_keeper: ({ context, network, timers, timeout_ms }: {
    context: PeerContext;
    network: Network | undefined;
    timers: Timers;
    timeout_ms: number;
}) => BlobKeeper;
