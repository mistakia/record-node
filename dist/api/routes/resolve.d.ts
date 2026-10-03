import { Router } from 'express';
import type { ResolverEntry, Resolver } from '#types/peer.ts';
export declare const to_resolver_entry: (record: Record<string, unknown>) => ResolverEntry;
export declare const resolve_router: (resolve: Resolver) => Router;
