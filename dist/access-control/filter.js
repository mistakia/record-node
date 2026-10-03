// FilterSpec (§3.5.7): a recursive predicate that scopes capabilities and
// selects tracks for selective replication (§4.6.1). Shape checking tells a
// malformed node, which rejects or refuses, from an unknown one, which fails
// closed: a filter holding any unknown node matches nothing, even under not.
import { is_record } from '#types/guards.ts';
export const MAX_SPEC_DEPTH = 16;
export const worst_shape = (...shapes) => shapes.includes('malformed') ? 'malformed' : shapes.includes('unknown') ? 'unknown' : 'ok';
export const has_extra_fields = (node, fields) => Object.keys(node).some((field) => !fields.includes(field));
const is_scalar = (value) => value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const RANGE_BOUNDS = ['gte', 'gt', 'lte', 'lt'];
export const filter_shape = (node, depth = 1) => {
    if (depth > MAX_SPEC_DEPTH || !is_record(node) || typeof node.type !== 'string')
        return 'malformed';
    const known = (fields, well_formed) => !well_formed ? 'malformed' : has_extra_fields(node, fields) ? 'unknown' : 'ok';
    switch (node.type) {
        case 'match': {
            const values = is_record(node.fields) ? Object.values(node.fields) : [];
            return known(['type', 'fields'], values.length >= 1 && values.length <= 16 && values.every(is_scalar));
        }
        case 'any_of':
            return known(['type', 'field', 'values'], typeof node.field === 'string' && Array.isArray(node.values) &&
                node.values.length >= 1 && node.values.length <= 256 && node.values.every(is_scalar));
        case 'range': {
            const bounds = RANGE_BOUNDS.filter((bound) => bound in node);
            return known(['type', 'field', ...RANGE_BOUNDS], typeof node.field === 'string' && bounds.length >= 1 &&
                bounds.every((bound) => typeof node[bound] === 'number'));
        }
        case 'and':
        case 'or': {
            const filters = node.filters;
            const well_formed = Array.isArray(filters) && filters.length >= 1 && filters.length <= 64;
            return worst_shape(known(['type', 'filters'], well_formed), ...(well_formed ? filters.map((filter) => filter_shape(filter, depth + 1)) : []));
        }
        case 'not':
            return worst_shape(known(['type', 'filter'], 'filter' in node), filter_shape(node.filter, depth + 1));
        default:
            return 'unknown';
    }
};
const resolve_path = (subject, path) => path.split('.').reduce((current, step) => is_record(current) && step in current ? current[step] : undefined, subject);
// Same type and value; an array holds a scalar when an element equals it.
const holds = (resolved, value) => Array.isArray(resolved)
    ? resolved.some((element) => typeof element === typeof value && element === value)
    : resolved !== undefined && typeof resolved === typeof value && resolved === value;
// Evaluates a node whose whole tree is known to be well formed.
const evaluate = (node, subject) => {
    switch (node.type) {
        case 'match':
            return Object.entries(node.fields).every(([path, value]) => holds(resolve_path(subject, path), value));
        case 'any_of':
            return node.values.some((value) => holds(resolve_path(subject, node.field), value));
        case 'range': {
            const value = resolve_path(subject, node.field);
            if (typeof value !== 'number')
                return false;
            const bound = (name) => node[name];
            return (!('gte' in node) || value >= bound('gte')) && (!('gt' in node) || value > bound('gt')) &&
                (!('lte' in node) || value <= bound('lte')) && (!('lt' in node) || value < bound('lt'));
        }
        case 'and':
            return node.filters.every((filter) => evaluate(filter, subject));
        case 'or':
            return node.filters.some((filter) => evaluate(filter, subject));
        case 'not':
            return !evaluate(node.filter, subject);
        default:
            return false;
    }
};
// An absent filter restricts nothing; one that is not wholly well formed and
// known matches nothing.
export const filter_matches = (filter, subject) => filter === undefined || (filter_shape(filter) === 'ok' && evaluate(filter, subject));
