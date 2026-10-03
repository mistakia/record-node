import { type ApiPeer } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const create_track_methods: (context: PeerContext) => Pick<ApiPeer, "list_tracks" | "add_track" | "remove_track" | "list_tags" | "add_tag" | "remove_tag" | "get_audio" | "has_audio">;
