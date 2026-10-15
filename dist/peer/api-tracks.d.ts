import { type ApiPeer } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const create_track_methods: (context: PeerContext) => Pick<ApiPeer, "list_tracks" | "add_track" | "update_track" | "rederive_track" | "remove_track" | "pin_track" | "unpin_track" | "list_tags" | "add_tag" | "remove_tag" | "change_labels" | "change_labels_batch" | "get_audio" | "has_audio" | "get_image">;
