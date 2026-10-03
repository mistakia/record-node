// Capabilities as the API reports and makes them (§3.5.5, §3.5.10, chapter 7
// Capability): every capability record a library holds, with its status, the
// ones this identity holds, and issuing and revoking them.
import { assert_issuable_capability, build_capability_record, build_revocation_record, condition_shape, grantee_matches, record_key } from '#access-control/capability-record.ts';
import { capability_chain, is_write_list_key } from '#access-control/capability.ts';
import { build_record_put_operation, is_access_record } from '#entry/operations.ts';
import { PeerError } from '#types/peer.ts';
import { require_identity, serialise_write } from "./context.js";
import { append_write, resolve_write_target } from "./write-target.js";
const record_of = (entry) => is_access_record(entry.operation) ? entry.operation.value : {};
const earliest_expiry = (conditions) => {
    const times = (Array.isArray(conditions) ? conditions : [])
        .filter((condition) => condition_shape(condition) === 'ok')
        .map((condition) => condition.at);
    return times.length === 0 ? null : Math.min(...times);
};
// The effective revocation naming a capability, if any.
const revocation_of = (oplog, capability_id) => [...oplog.effective].find((hash) => (record_of(oplog.entries.get(hash)).revokes) === capability_id) ?? null;
// expired is advisory: it reads the node's clock, while verification reads
// each write's own timestamp (§3.5.8).
export const describe_capability = (oplog, entry, now = Date.now()) => {
    const record = record_of(entry);
    const revoked_by = revocation_of(oplog, entry.hash);
    const expires_at_ms = earliest_expiry(record.conditions);
    const status = revoked_by !== null
        ? 'revoked'
        : oplog.inert.has(entry.hash)
            ? 'inert'
            : expires_at_ms !== null && now > expires_at_ms ? 'expired' : 'active';
    const cited = entry.operation.capability_id;
    return {
        capability_id: entry.hash,
        library_address: oplog.chain.address,
        issuer: entry.entry.key,
        via_capability_id: is_write_list_key(oplog, entry.entry.key) ? null : cited ?? null,
        grantee: record.grantee,
        actions: Array.isArray(record.actions) ? record.actions.filter((action) => typeof action === 'string') : [],
        filter: (record.filter ?? null),
        conditions: (Array.isArray(record.conditions) ? record.conditions : []),
        issued_at_ms: record.timestamp,
        expires_at_ms,
        status,
        revoked_by
    };
};
export const list_capabilities = (context, address) => {
    const oplog = context.libraries.get(address)?.oplog;
    if (oplog === undefined)
        throw new PeerError('not_found', `unknown library: ${address}`);
    return [...oplog.capabilities.values()].map((entry) => describe_capability(oplog, entry));
};
// Capabilities in every open recordstore whose grantee matches this identity.
export const held_capabilities = (context) => {
    const { public_key } = require_identity(context).key_pair;
    return context.libraries.list().flatMap(({ oplog }) => [...oplog.capabilities.values()]
        .filter((entry) => grantee_matches(record_of(entry).grantee, public_key))
        .map((entry) => describe_capability(oplog, entry)));
};
export const held_capability_ids = (context, address) => held_capabilities(context).filter(({ library_address, status }) => library_address === address && status === 'active').map(({ capability_id }) => capability_id);
// The node issues only what it could verify writes under (§3.5.5).
export const issue_capability = async (context, { library_address, grantee, actions, filter, conditions, capability_id }) => await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address, capability_id });
    const value = build_capability_record({ grantee, actions, filter, conditions });
    assert_issuable_capability(value);
    const entry = await append_write(context, target, build_record_put_operation({ key: record_key(value), value, capability_id: target.capability_id }));
    return describe_capability(target.handle.oplog, entry);
});
// The owner revokes any capability; another identity, one in whose chain it
// signed, citing a capability it holds (§3.5.10). Verification decides.
export const revoke_capability = async (context, { library_address, revokes, capability_id }) => {
    await serialise_write(context, async () => {
        const target = resolve_write_target(context, { library_address, capability_id });
        if (!target.handle.oplog.capabilities.has(revokes))
            throw new PeerError('not_found', `no capability ${revokes} in ${library_address}`);
        if (target.capability_id === undefined && revocation_of(target.handle.oplog, revokes) !== null)
            return;
        const value = build_revocation_record({ revokes });
        await append_write(context, target, build_record_put_operation({ key: record_key(value), value, capability_id: target.capability_id }));
    });
};
// The capability a revoked entry depended on: the first in its chain an
// effective revocation names.
export const revoked_dependency = (oplog, entry) => {
    const revoked = new Set([...oplog.effective].map((hash) => record_of(oplog.entries.get(hash)).revokes));
    return capability_chain(oplog, entry.operation.capability_id).find((hash) => revoked.has(hash));
};
