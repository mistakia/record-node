import { Router } from 'express';
import type { ApiPeer } from '#types/peer.ts';
export declare const audio_router: (peer: ApiPeer, log_error: (error: unknown) => void) => Router;
