import { Router } from 'express';
import type { ApiPeer } from '#types/peer.ts';
import { type ManagedLabelLibraries } from '../middleware.ts';
export declare const tracks_router: (peer: ApiPeer, managed: ManagedLabelLibraries) => Router;
