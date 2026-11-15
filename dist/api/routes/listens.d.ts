import { Router } from 'express';
import type { ApiPeer } from '#types/peer.ts';
export declare const LISTEN_FUTURE_SKEW_WINDOW_MS: number;
export declare const LISTEN_PAST_ACCEPTANCE_WINDOW_MS: number;
export declare const listens_router: (peer: ApiPeer) => Router;
