import type { Library } from '#types/peer.ts';
import type { PeerContext } from './context.ts';
import { type LibraryScope } from './ownership.ts';
export declare const describe_library: (context: PeerContext, address: string, scope?: LibraryScope) => Library | undefined;
