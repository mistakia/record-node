// The API Library of one library this peer knows (chapter 7 Library): what
// the identity library says about it, its index summary, its policy, and its
// replication state.
import { get_about, get_library_summary } from '#query-db/queries.ts';
import { held_capability_ids } from "./capabilities.js";
import { library_scope } from "./ownership.js";
import { effective_policy } from "./policy.js";
import { to_api_library } from "./views.js";
// The replicator's counters; without one, every entry the oplog holds is all
// there is.
const replication_of = (context, address) => {
    const replicator = context.replication?.get(address);
    if (replicator === undefined) {
        const length = context.libraries.get(address)?.oplog.entries.size ?? 0;
        return { status: { progress: length, total: length }, is_replicating: false, connected: true, peer_ids: [] };
    }
    const status = replicator.status();
    return {
        status,
        is_replicating: replicator.state() === 'running' && status.progress < status.total,
        connected: replicator.state() !== 'paused',
        peer_ids: replicator.peer_ids()
    };
};
// Undefined for a library that is neither own, nor linked, nor one the
// identity holds a capability in. A caller describing many libraries passes
// one scope for all of them.
export const describe_library = (context, address, scope = library_scope(context)) => {
    const own = scope.own.get(address);
    const link = scope.links.get(address);
    const held = held_capability_ids(context, address);
    if (own === undefined && link === undefined && held.length === 0)
        return undefined;
    const handle = context.libraries.get(address);
    return to_api_library({
        address,
        library_type: handle?.chain.type ?? own?.type ?? 'recordstore',
        heads: handle === undefined ? [] : [...handle.oplog.heads].sort(),
        summary: get_library_summary({ db: context.db, library_address: address }),
        about: get_about({ db: context.db, library_address: address }),
        alias: link?.alias ?? null,
        is_own: own !== undefined,
        is_retired: own?.retired ?? false,
        is_linked: link !== undefined,
        held_capability_ids: held,
        replication_mode: effective_policy(context, address, scope)?.mode ?? null,
        is_loading: handle === undefined,
        replication: replication_of(context, address)
    });
};
