// FilterSpec (§3.5.7): a recursive predicate that scopes capabilities and
// selects tracks for selective replication (§4.6.1). Shape checking tells a
// malformed node, which rejects or refuses, from an unknown one, which fails
// closed: a filter holding any unknown node matches nothing, even under not.

import { is_record } from '#types/guards.ts'

// ok, unknown (fail closed), or malformed (reject or refuse).
export type Shape = 'ok' | 'unknown' | 'malformed'

export const MAX_SPEC_DEPTH = 16

export const worst_shape = (...shapes: Shape[]): Shape =>
  shapes.includes('malformed') ? 'malformed' : shapes.includes('unknown') ? 'unknown' : 'ok'

export const has_extra_fields = (node: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(node).some((field) => !fields.includes(field))

const is_scalar = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const RANGE_BOUNDS = ['gte', 'gt', 'lte', 'lt'] as const

export const filter_shape = (node: unknown, depth = 1): Shape => {
  if (depth > MAX_SPEC_DEPTH || !is_record(node) || typeof node.type !== 'string') return 'malformed'
  const known = (fields: readonly string[], well_formed: boolean): Shape =>
    !well_formed ? 'malformed' : has_extra_fields(node, fields) ? 'unknown' : 'ok'
  switch (node.type) {
    case 'match': {
      const values = is_record(node.fields) ? Object.values(node.fields) : []
      return known(['type', 'fields'], values.length >= 1 && values.length <= 16 && values.every(is_scalar))
    }
    case 'any_of':
      return known(['type', 'field', 'values'], typeof node.field === 'string' && Array.isArray(node.values) &&
        node.values.length >= 1 && node.values.length <= 256 && node.values.every(is_scalar))
    case 'range': {
      const bounds = RANGE_BOUNDS.filter((bound) => bound in node)
      return known(['type', 'field', ...RANGE_BOUNDS], typeof node.field === 'string' && bounds.length >= 1 &&
        bounds.every((bound) => typeof node[bound] === 'number'))
    }
    case 'and':
    case 'or': {
      const filters = node.filters
      const well_formed = Array.isArray(filters) && filters.length >= 1 && filters.length <= 64
      return worst_shape(known(['type', 'filters'], well_formed),
        ...(well_formed ? filters.map((filter: unknown) => filter_shape(filter, depth + 1)) : []))
    }
    case 'not':
      return worst_shape(known(['type', 'filter'], 'filter' in node), filter_shape(node.filter, depth + 1))
    default:
      return 'unknown'
  }
}

const resolve_path = (subject: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, step) => is_record(current) && step in current ? current[step] : undefined, subject)

// Same type and value; an array holds a scalar when an element equals it.
const holds = (resolved: unknown, value: unknown): boolean =>
  Array.isArray(resolved)
    ? resolved.some((element) => typeof element === typeof value && element === value)
    : resolved !== undefined && typeof resolved === typeof value && resolved === value

// Evaluates a node whose whole tree is known to be well formed.
const evaluate = (node: Record<string, unknown>, subject: unknown): boolean => {
  switch (node.type) {
    case 'match':
      return Object.entries(node.fields as Record<string, unknown>).every(([path, value]) => holds(resolve_path(subject, path), value))
    case 'any_of':
      return (node.values as unknown[]).some((value) => holds(resolve_path(subject, node.field as string), value))
    case 'range': {
      const value = resolve_path(subject, node.field as string)
      if (typeof value !== 'number') return false
      const bound = (name: typeof RANGE_BOUNDS[number]) => node[name] as number
      return (!('gte' in node) || value >= bound('gte')) && (!('gt' in node) || value > bound('gt')) &&
        (!('lte' in node) || value <= bound('lte')) && (!('lt' in node) || value < bound('lt'))
    }
    case 'and':
      return (node.filters as Array<Record<string, unknown>>).every((filter) => evaluate(filter, subject))
    case 'or':
      return (node.filters as Array<Record<string, unknown>>).some((filter) => evaluate(filter, subject))
    case 'not':
      return !evaluate(node.filter as Record<string, unknown>, subject)
    default:
      return false
  }
}

// An absent filter restricts nothing; one that is not wholly well formed and
// known matches nothing.
export const filter_matches = (filter: unknown, subject: unknown): boolean =>
  filter === undefined || (filter_shape(filter) === 'ok' && evaluate(filter as Record<string, unknown>, subject))
