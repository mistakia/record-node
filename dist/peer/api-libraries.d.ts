import { type ApiPeer } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const try_open_library: (context: PeerContext, address: string) => Promise<void>;
export declare const create_library_methods: (context: PeerContext) => Pick<ApiPeer, "list_libraries" | "get_library" | "link_library" | "unlink_library" | "connect_library" | "disconnect_library" | "get_about" | "set_about" | "list_listens" | "record_listen">;
