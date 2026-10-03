import { type ImportAck, type WriteTargetInput } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const import_files: (context: PeerContext, { paths, library_address, capability_id }: {
    paths: string[];
} & WriteTargetInput) => ImportAck;
export declare const import_url: (context: PeerContext, { url, library_address, capability_id }: {
    url: string;
} & WriteTargetInput) => Promise<ImportAck>;
