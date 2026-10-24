import type { Network } from '#fabric/network.ts';
import { type VerifiedProfile } from '#replication/announcement.ts';
import { type AnnouncedLibrary } from '#replication/messages.ts';
import type { Timers } from '#replication/timers.ts';
import type { PeerContext } from './context.ts';
export interface AnnouncedState {
    readonly profiles: Map<string, VerifiedProfile>;
    readonly owners: Map<string, string>;
}
export declare const create_announced_state: () => AnnouncedState;
export interface AnnouncedBy {
    readonly hints: readonly AnnouncedLibrary[];
    readonly verified: ReadonlySet<string>;
}
export interface PeerAnnouncements {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    announced_by: (peer_id: string) => AnnouncedBy | undefined;
}
export declare const create_peer_announcements: ({ context, network, timers, get_block, on_peer_join, on_peer_leave, on_library_verified, on_profile }: {
    context: PeerContext;
    network: Network;
    timers: Timers;
    get_block: (cid: string) => Promise<Uint8Array | undefined>;
    on_peer_join: (peer_id: string) => void;
    on_peer_leave: (peer_id: string) => void;
    on_library_verified?: ((library_address: string) => void) | undefined;
    on_profile?: ((key: string) => void) | undefined;
}) => PeerAnnouncements;
