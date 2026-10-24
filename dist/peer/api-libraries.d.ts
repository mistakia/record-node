import type { ProfileRecord } from '#types/entry.ts';
import { type ApiPeer, type Profile } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const to_api_profile: (public_key: string, record: ProfileRecord | undefined) => Profile;
export declare const create_library_methods: (context: PeerContext) => Pick<ApiPeer, "list_libraries" | "get_library" | "link_library" | "unlink_library" | "connect_library" | "disconnect_library" | "get_replication_policy" | "set_replication_policy" | "list_capabilities" | "issue_capability" | "revoke_capability" | "get_about" | "set_about" | "get_library_profile" | "list_listens" | "record_listen" | "get_identity" | "get_profile" | "set_profile" | "list_own_libraries" | "create_own_library" | "retire_own_library" | "list_held_capabilities" | "read_meta_log">;
