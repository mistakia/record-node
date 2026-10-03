import { type Importer } from '#types/ingest.ts';
import { type ImportAck } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const create_file_importer: (context: PeerContext) => Importer;
export declare const import_url: (context: PeerContext, url: string) => Promise<ImportAck>;
