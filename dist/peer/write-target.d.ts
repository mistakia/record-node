import type { VerifiedEntry } from '#oplog/accept.ts';
import { type PeerContext } from './context.ts';
import type { LibraryHandle } from './library.ts';
export interface WriteTarget {
    readonly address: string;
    readonly handle: LibraryHandle;
    readonly capability_id: string | undefined;
}
export declare const assert_writable: (context: PeerContext, { address }: {
    address: string;
}) => void;
export declare const resolve_write_target: (context: PeerContext, { library_address, capability_id }: {
    library_address?: string | undefined;
    capability_id?: string | undefined;
}) => WriteTarget;
export declare const as_write_refusal: (error: unknown) => unknown;
export declare const append_write: (context: PeerContext, target: WriteTarget, payload: unknown) => Promise<VerifiedEntry>;
