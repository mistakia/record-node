import type { Network } from '#fabric/network.ts';
import { type AnnouncedLibrary } from '#replication/messages.ts';
import type { Timers } from '#replication/timers.ts';
import type { PeerContext } from './context.ts';
export interface AnnouncedBy {
    readonly hints: readonly AnnouncedLibrary[];
    readonly verified: ReadonlySet<string>;
}
export interface PeerAnnouncements {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    announced_by: (peer_id: string) => AnnouncedBy | undefined;
}
export declare const create_peer_announcements: ({ context, network, timers, get_block, on_peer_join, on_peer_leave, on_library_verified }: {
    context: PeerContext;
    network: Network;
    timers: Timers;
    get_block: (cid: string) => Promise<Uint8Array | undefined>;
    on_peer_join: (peer_id: string) => void;
    on_peer_leave: (peer_id: string) => void;
    on_library_verified?: ((library_address: string) => void) | undefined;
}) => PeerAnnouncements;
