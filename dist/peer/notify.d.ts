import type { VerifiedEntry } from '#oplog/accept.ts';
import type { PeerContext } from './context.ts';
export declare const project_entry_events: ({ context, library_address, entries, inert, batched }: {
    context: PeerContext;
    library_address: string;
    entries: readonly VerifiedEntry[];
    inert: readonly VerifiedEntry[];
    batched?: boolean;
}) => void;
