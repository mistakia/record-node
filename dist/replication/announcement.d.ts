import { type ResolvedAcChain } from '#access-control/resolve.ts';
import { type HashedEntry } from '#entry/signed.ts';
import { type PubSub } from '#fabric/pubsub.ts';
import type { AboutRecord, ProfileRecord, SignedEntry } from '#types/entry.ts';
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
export interface VerifiedLibrary {
    readonly chain: ResolvedAcChain;
    readonly about?: {
        readonly hashed: HashedEntry;
        readonly record: AboutRecord;
    } | undefined;
}
export declare const verify_announced_library: ({ announced, get_block }: {
    announced: AnnouncedLibrary;
    get_block: (cid: string) => Promise<Uint8Array | undefined>;
}) => Promise<VerifiedLibrary | undefined>;
export interface VerifiedProfile {
    readonly hashed: HashedEntry;
    readonly record: ProfileRecord;
}
export declare const verify_announced_profile: (value: SignedEntry) => VerifiedProfile | undefined;
