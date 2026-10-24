// Write targets (chapter 7 write targets, §3.5.9, §4.8.3, §4.9): which
// library a write goes to, and under what authority. An own library takes the
// write by the owner shortcut, unless retired; any other recordstore needs a
// cited capability, which append verification judges. Its refusals become the
// API's 403 codes. A labels library takes label and About writes only, and
// is where a label write goes when it names no target.
import { ProtocolError } from '#types/errors.ts';
import { PeerError } from '#types/peer.ts';
import { require_identity } from "./context.js";
import { default_write_target, find_own_library, labels_library } from "./ownership.js";
// An own library, once retired, refuses new local writes (§4.8.3).
export const assert_writable = (context, { address }) => {
    if (find_own_library(context, address)?.retired === true)
        throw new PeerError('conflict', `library is retired: ${address}`);
};
const takes = (type, kind) => type === 'recordstore' || (type === 'labels' && kind !== 'track');
export const resolve_write_target = (context, { library_address, capability_id, kind = 'track' }) => {
    const address = library_address ?? (kind === 'label' ? labels_library(context) : default_write_target(context));
    if (address === undefined) {
        throw new PeerError('invalid', kind === 'label'
            ? 'library_address is required: the identity has no active labels library'
            : 'library_address is required: the identity has no single active own recordstore library');
    }
    const handle = context.libraries.get(address);
    if (handle === undefined)
        throw new PeerError('not_found', `library not open: ${address}`);
    if (!takes(handle.chain.type, kind)) {
        throw new PeerError('invalid', `a ${handle.chain.type} library does not take ${kind === 'track' ? 'this write' : `a ${kind} write`}: ${address}`);
    }
    assert_writable(context, { address });
    if (handle.chain.write_list.includes(require_identity(context).key_pair.public_key)) {
        return { address, handle, capability_id: undefined };
    }
    if (capability_id === undefined)
        throw new PeerError('forbidden', `not an owner of ${address}, and no capability_id was given`);
    return { address, handle, capability_id };
};
// A capability refusal from append verification, as the API reports it.
export const as_write_refusal = (error) => {
    if (!(error instanceof ProtocolError))
        return error;
    if (error.code === 'capability_expired')
        return new PeerError('capability_expired', error.message);
    if (error.code === 'capability_revoked')
        return new PeerError('capability_revoked', error.message);
    if (error.code === 'capability_denied' || error.code === 'unauthorised_writer')
        return new PeerError('forbidden', error.message);
    return error;
};
export const append_write = async (context, target, payload) => {
    try {
        return await context.libraries.append({ library_address: target.address, payload, key_pair: require_identity(context).key_pair });
    }
    catch (error) {
        throw as_write_refusal(error);
    }
};
