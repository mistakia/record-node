// What the identity library makes of the libraries this peer knows (§4.8.3,
// §4.8.4): the own libraries, which must also carry the identity key in their
// AC write list, the link set, and the scopes queries and writes default to.
// Everything here is derived from oplogs on each call, so it never drifts
// from what replication merged.
import { compute_log_id } from '#entry/id.ts';
import { identity_library_state } from '#oplog/identity-library.ts';
import { list_linked_libraries } from '#query-db/queries.ts';
import { require_identity } from "./context.js";
// The own library record-node v1.0 created for every identity; the default
// own library when more than one is active (chapter 7 own_library_address).
export const OWN_LIBRARY_NAME = 'record';
export const LISTENS_LIBRARY_NAME = 'listens';
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
// The identity's default own recordstore: its only active one, or else the
// one record-node names by default, or else the first active one.
export const default_own_library = (context) => {
    const active = active_own_libraries(context, 'recordstore');
    if (active.length === 1)
        return active[0]?.address;
    return (active.find(({ name }) => name === OWN_LIBRARY_NAME) ?? active[0])?.address;
};
// The identity's listens library: its active own listens library (§4.8.3).
export const listens_library = (context) => active_own_libraries(context, 'listens')[0]?.address;
// §4.8.4: the identity library's link records decide every address they
// name; a v1.0 Log entry in an own recordstore, active or retired, links an
// address no link record names.
export const link_set = (context) => {
    const state = identity_state(context);
    const links = new Map();
    for (const [address, { alias }] of state.links)
        links.set(address, { address, alias: alias ?? null, source: 'identity' });
    for (const own of own_libraries(context)) {
        if (own.type !== 'recordstore')
            continue;
        for (const { address, alias } of list_linked_libraries({ db: context.db, library_address: own.address })) {
            if (state.link_keys.has(compute_log_id(address)) || links.has(address))
                continue;
            links.set(address, { address, alias, source: 'legacy' });
        }
    }
    return [...links.values()].sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
};
export const linked_addresses = (context) => link_set(context).map(({ address }) => address);
// Own recordstore libraries, active and retired, then the link set: the
// default scope of every query.
export const visible_addresses = (context) => [
    ...own_libraries(context).filter(({ type }) => type === 'recordstore').map(({ address }) => address),
    ...linked_addresses(context)
];
export const own_recordstore_addresses = (context) => own_libraries(context).filter(({ type }) => type === 'recordstore').map(({ address }) => address);
export const library_scope = (context) => ({
    own: new Map(own_libraries(context).map((library) => [library.address, library])),
    links: new Map(link_set(context).map((link) => [link.address, link]))
});
