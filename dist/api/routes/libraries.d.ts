import { Router } from 'express';
import type { AboutUpdate, ApiPeer } from '#types/peer.ts';
export declare const about_fields: (body: Record<string, unknown>) => AboutUpdate;
export declare const libraries_router: (peer: ApiPeer) => Router;
