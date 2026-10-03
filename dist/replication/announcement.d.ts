import { type ResolvedAcChain } from '#access-control/resolve.ts';
import { type PubSub } from '#fabric/pubsub.ts';
import type { AnnouncedLibrary } from './messages.ts';
import type { Timers } from './timers.ts';
export interface Announcer {
    announce_self: () => void;
    peer_joined: (peer_id: string) => void;
    stop: () => void;
}
export declare const create_announcer: ({ pubsub, interval_ms, timers, build }: {
    pubsub: PubSub;
    interval_ms: number;
    timers: Timers;
    build: () => Promise<Uint8Array | undefined>;
}) => Announcer;
export interface AuthenticatedAbout {
    readonly chain: ResolvedAcChain;
    readonly content: Record<string, unknown>;
}
export declare const authenticate_announced: ({ announced, get_block }: {
    announced: AnnouncedLibrary;
    get_block: (cid: string) => Promise<Uint8Array | undefined>;
}) => Promise<AuthenticatedAbout | undefined>;
