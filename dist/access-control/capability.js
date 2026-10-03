// Capability verification and revocation (§3.5.9, §3.5.10): whether a
// capability authorises an entry, judged over the entry's causal past alone,
// and which revocations are effective, from which inertness follows. A
// write-list signer is authorised by membership alone (§3.5.4).
import { is_access_record, is_envelope_operation, is_put } from '#entry/operations.ts';
import { in_causal_past } from '#oplog/causal.ts';
import { compare_bytes, compare_current_state, envelope_timestamp } from '#oplog/current-state.ts';
import { capability_fails_closed, condition_shape, grantee_matches } from "./capability-record.js";
import { filter_matches } from "./filter.js";
export const MAX_CHAIN_LENGTH = 8;
const ok = Object.freeze({ ok: true });
const fail = (code, reason) => ({ ok: false, code, reason });
export const is_write_list_key = (oplog, key) => oplog.chain.write_list.includes(key);
const capability_record = (entry) => entry !== undefined && is_access_record(entry.operation) && entry.operation.value.type === 'capability'
    ? entry.operation.value
    : undefined;
// A capability's chain: itself while a write-list key signed it, otherwise
// itself followed by the chain of the capability its entry cites.
export const capability_chain = (oplog, capability_id) => {
    const chain = [];
    for (let hash = capability_id; hash !== undefined;) {
        const entry = oplog.entries.get(hash);
        if (capability_record(entry) === undefined || entry === undefined)
            return chain;
        chain.push(hash);
        if (is_write_list_key(oplog, entry.entry.key))
            return chain;
        hash = entry.operation.capability_id;
    }
    return chain;
};
const cited_capability = (operation) => 'capability_id' in operation ? operation.capability_id : undefined;
// The capabilities an entry depends on: the chain of the one it cites.
const dependencies = (oplog, entry) => is_write_list_key(oplog, entry.entry.key) ? [] : capability_chain(oplog, cited_capability(entry.operation));
const revoked_capability = (revocation) => revocation.operation.value.revokes;
// Inert: the entry depends on a capability an effective revocation names, and
// is not in that revocation's causal past.
export const inert_under = (oplog, entry, effective) => {
    const chain = dependencies(oplog, entry);
    return chain.length > 0 && effective.some((revocation) => chain.includes(revoked_capability(revocation)) &&
        !in_causal_past({ entries: oplog.entries, ancestor: entry.hash, next: revocation.entry.next }));
};
const self_referential = (oplog, revocation) => capability_chain(oplog, cited_capability(revocation.operation)).includes(revoked_capability(revocation));
// The ordered effective-set procedure over accepted revocations: every
// write-list revocation, then the others by (clock.time, value timestamp,
// hash bytes) ascending, each effective unless self-referential or made
// inert by one found effective before it.
export const effective_revocations = (oplog, revocations) => {
    const all = [...revocations];
    const effective = all.filter((revocation) => is_write_list_key(oplog, revocation.entry.key));
    const delegated = all.filter((revocation) => !is_write_list_key(oplog, revocation.entry.key)).sort((a, b) => a.entry.clock.time - b.entry.clock.time || envelope_timestamp(a) - envelope_timestamp(b) || compare_bytes(a.multihash, b.multihash));
    for (const revocation of delegated) {
        if (!self_referential(oplog, revocation) && !inert_under(oplog, revocation, effective))
            effective.push(revocation);
    }
    return effective;
};
// §3.5.6 base entry of an append_tag PUT: among the track entries for its id
// in its causal past, the one §4.4.2 puts first, inertness ignored.
const base_entry = (oplog, { id, next }) => {
    let base;
    for (const hash of oplog.key_entries.get(id) ?? []) {
        const candidate = oplog.entries.get(hash);
        if (candidate === undefined || !is_envelope_operation(candidate.operation) || candidate.operation.value.type !== 'track')
            continue;
        if (!in_causal_past({ entries: oplog.entries, ancestor: hash, next }))
            continue;
        if (base === undefined || compare_current_state(candidate, base) < 0)
            base = candidate;
    }
    return base;
};
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
// The actions that authorise a PUT (§3.5.6), read from the value as signed.
const covering_actions = (oplog, { value, next }) => {
    switch (value.type) {
        case 'track': {
            const base = base_entry(oplog, { id: value.id, next });
            const prior = base?.operation;
            const keeps_base = prior !== undefined && is_put(prior) && prior.value.content === value.content && (prior.value.tags ?? []).every((tag) => strings(value.tags).includes(tag));
            return keeps_base ? ['library.append_track', 'library.append_tag'] : ['library.append_track'];
        }
        case 'about': return ['library.update_about'];
        case 'capability': return ['library.grant_capability'];
        default: return [];
    }
};
// Why a capability's conditions fail an operation, or undefined when they hold.
const condition_failure = (conditions, timestamp) => {
    const list = Array.isArray(conditions) ? conditions : [];
    if (list.some((condition) => condition_shape(condition) !== 'ok'))
        return 'unrecognised';
    return list.some((condition) => timestamp > condition.at) ? 'expired' : undefined;
};
// §3.5.9 and §3.5.10 for an entry about to join the oplog: its parents are
// in the oplog, and the entry is not.
export const authorise_entry = ({ oplog, hashed, operation }) => {
    const { key, next, payload } = hashed.entry;
    if (is_write_list_key(oplog, key))
        return ok;
    if (oplog.chain.type !== 'recordstore')
        return fail('unauthorised_writer', `${key} is not in the write list`);
    const capability_id = cited_capability(operation);
    // Step 1.
    if (!('op' in operation) || operation.op !== 'PUT' || capability_id === undefined) {
        return fail('unauthorised_writer', `${key} is not in the write list and cites no capability`);
    }
    // Steps 2 to 4.
    const cited = oplog.entries.get(capability_id);
    const record = capability_record(cited);
    if (record === undefined || !in_causal_past({ entries: oplog.entries, ancestor: capability_id, next })) {
        return fail('capability_denied', `capability ${capability_id} is not a capability in the entry's causal past`);
    }
    if (!grantee_matches(record.grantee, key))
        return fail('capability_denied', `capability ${capability_id} is not granted to ${key}`);
    const chain = capability_chain(oplog, capability_id);
    if (chain.length > MAX_CHAIN_LENGTH)
        return fail('capability_denied', `capability ${capability_id} has a chain of ${chain.length}, over ${MAX_CHAIN_LENGTH}`);
    // Step 6: the effective set over the causal past alone.
    const past_revocations = [...oplog.revocations.values()].filter((revocation) => in_causal_past({ entries: oplog.entries, ancestor: revocation.hash, next }));
    const revoked = effective_revocations(oplog, past_revocations).find((revocation) => chain.includes(revoked_capability(revocation)));
    if (revoked !== undefined)
        return fail('capability_revoked', `capability ${revoked_capability(revoked)} is revoked by ${revoked.hash} in the entry's causal past`);
    const value = payload.value;
    // A revocation is checked by scope, not by actions, filters, or conditions.
    if (value.type === 'revocation') {
        const target = value.revokes;
        const in_scope = capability_record(oplog.entries.get(target)) !== undefined &&
            in_causal_past({ entries: oplog.entries, ancestor: target, next }) &&
            capability_chain(oplog, target).some((hash) => oplog.entries.get(hash)?.entry.key === key);
        return in_scope ? ok : fail('capability_denied', `${key} issued neither ${target} nor a capability above it`);
    }
    // Step 5, against every capability in the chain.
    const actions = covering_actions(oplog, { value, next });
    const subject = value.type === 'track' ? { ...value, tags: value.tags ?? [] } : value;
    for (const hash of chain) {
        const capability = capability_record(oplog.entries.get(hash));
        if (capability_fails_closed(capability))
            return fail('capability_denied', `capability ${hash} carries a field this version does not define`);
        if (!strings(capability.actions).some((action) => actions.includes(action))) {
            return fail('capability_denied', `capability ${hash} grants no action that authorises this ${String(value.type)} PUT`);
        }
        if ((value.type === 'track' || value.type === 'about') && !filter_matches(capability.filter, subject)) {
            return fail('capability_denied', `capability ${hash}'s filter does not match the write`);
        }
        const failure = condition_failure(capability.conditions, value.timestamp);
        if (failure === 'expired')
            return fail('capability_expired', `capability ${hash} has expired for a write timestamped ${String(value.timestamp)}`);
        if (failure !== undefined)
            return fail('capability_denied', `capability ${hash} holds a condition this version does not define`);
    }
    return ok;
};
