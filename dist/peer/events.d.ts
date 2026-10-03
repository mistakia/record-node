import type { PeerEvent } from '#types/peer.ts';
export interface EventBus {
    emit: (event: PeerEvent) => void;
    subscribe: (handler: (event: PeerEvent) => void) => () => void;
}
export declare const create_event_bus: () => EventBus;
