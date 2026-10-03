import type { Network } from '#fabric/network.ts';
import { type Replicator } from '#replication/replicator.ts';
import { type Timers } from '#replication/timers.ts';
import type { Library, PeerInfo } from '#types/peer.ts';
import { type AnnouncedBy } from './announcements.ts';
import { type PeerContext } from './context.ts';
export interface PeerReplication {
    readonly network: Network;
    start: () => Promise<void>;
    sync: () => Promise<void>;
    connect: (library_address: string) => Promise<void>;
    pause: (library_address: string) => void;
    unlink: (library_address: string) => Promise<void>;
    heads_changed: (library_address: string) => void;
    get: (library_address: string) => Replicator | undefined;
    settled: (library_address: string) => Promise<void>;
    announced_by: (peer_id: string) => AnnouncedBy | undefined;
    list_peers: () => PeerInfo[];
    stop: () => Promise<void>;
}
export declare const create_peer_replication: ({ context, network, describe_library, timers }: {
    context: PeerContext;
    network: Network;
    describe_library: (library_address: string) => Library | undefined;
    timers?: Timers;
}) => PeerReplication;
