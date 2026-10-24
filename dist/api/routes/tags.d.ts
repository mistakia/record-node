import { Router } from 'express';
import type { ApiPeer } from '#types/peer.ts';
import { type ManagedLabelLibraries } from '../middleware.ts';
export declare const tags_router: (peer: ApiPeer, managed: ManagedLabelLibraries) => Router;
