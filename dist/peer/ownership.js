// What the identity library makes of the libraries this peer knows (§4.8.3,
// §4.8.4): the own libraries, which must also carry the identity key in their
// AC write list, the link set, and the scopes queries and writes default to.
// Everything here is derived from oplogs on each call, so it never drifts
// from what replication merged.
import { identity_library_state, least_entry } from '#oplog/identity-library.ts';
import { require_identity } from "./context.js";
// The initial discriminators of the listens and labels libraries (§3.6.1).
export const LISTENS_LIBRARY_NAME = 'listens';
export const LABELS_LIBRARY_NAME = 'labels';
export const identity_state = (context) => {
    const oplog = context.libraries.get(require_identity(context).identity_address)?.oplog;
    if (oplog === undefined)
        throw new Error('the identity library is not open');
    return identity_library_state(oplog);
};
// A recorded library counts once its AC chain is open and lists the key, so
// an identity library cannot claim another identity's library.
export const own_libraries = (context) => {
    const { key_pair } = require_identity(context);
    return [...identity_state(context).libraries].flatMap(([address, { retired }]) => {
        const chain = context.libraries.get(address)?.chain;
        if (chain === undefined || !chain.write_list.includes(key_pair.public_key))
            return [];
        return [{ address, type: chain.type, name: chain.name, retired }];
    });
};
export const find_own_library = (context, address) => own_libraries(context).find((library) => library.address === address);
export const active_own_libraries = (context, type) => own_libraries(context).filter((library) => library.type === type && !library.retired);
// The write target when a request names none: the only active own recordstore.
export const default_write_target = (context) => {
    const active = active_own_libraries(context, 'recordstore');
    return active.length === 1 ? active[0]?.address : undefined;
};
// The identity's default import target (chapter 7 own_library_address): the
// active own recordstore whose library PUT is least under §4.4.2 order, that
// is, the oldest. Never the labels or listens library (§4.9).
export const default_own_library = (context) => {
    const recorded = identity_state(context).libraries;
    const by_put = new Map(active_own_libraries(context, 'recordstore').flatMap(({ address }) => {
        const first_put = recorded.get(address)?.first_put;
        return first_put === undefined ? [] : [[first_put, address]];
    }));
    const least = least_entry([...by_put.keys()]);
    return least === undefined ? undefined : by_put.get(least);
};
// The identity's listens library: its active own listens library (§4.8.3).
export const listens_library = (context) => active_own_libraries(context, 'listens')[0]?.address;
// The identity's labels library: its active own labels library (§4.8.3, §4.9).
export const labels_library = (context) => active_own_libraries(context, 'labels')[0]?.address;
// §4.8.4: the addresses whose current link record is a PUT, and nothing else.
export const link_set = (context) => [...identity_state(context).links]
    .map(([address, { alias }]) => ({ address, alias: alias ?? null }))
    .sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
export const linked_addresses = (context) => link_set(context).map(({ address }) => address);
// Own recordstore libraries, active and retired, then the link set: the
// default scope of every query.
export const visible_addresses = (context) => [
    ...own_libraries(context).filter(({ type }) => type === 'recordstore').map(({ address }) => address),
    ...linked_addresses(context)
];
export const own_recordstore_addresses = (context) => own_libraries(context).filter(({ type }) => type === 'recordstore').map(({ address }) => address);
// Own libraries that can carry labels (§2.5): recordstores and the labels
// library, active and retired.
export const own_label_addresses = (context) => own_libraries(context).filter(({ type }) => type === 'recordstore' || type === 'labels').map(({ address }) => address);
// The default label_libraries of a read (chapter 7 LabelLibraries): every own
// recordstore and labels library, plus the request's membership scope, or,
// with none, every library the node shows.
export const default_label_libraries = (context, library_addresses) => [...new Set([...own_label_addresses(context), ...(library_addresses ?? linked_addresses(context))])];
export const library_scope = (context) => ({
    own: new Map(own_libraries(context).map((library) => [library.address, library])),
    links: new Map(link_set(context).map((link) => [link.address, link]))
});
