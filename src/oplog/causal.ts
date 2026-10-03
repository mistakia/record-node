// Causal past (§3.5.6): the entries reachable from an entry through next,
// transitively. clock.time grows strictly along next (§4.2), so a walk looking
// for one ancestor never descends past that ancestor's clock.

import type { HashedEntry } from '#entry/signed.ts'

export const in_causal_past = ({ entries, ancestor, next }: {
  entries: ReadonlyMap<string, HashedEntry>
  ancestor: string
  // The next of the entry whose past is searched.
  next: readonly string[]
}): boolean => {
  const floor = entries.get(ancestor)?.entry.clock.time
  if (floor === undefined) return false
  const seen = new Set<string>()
  const stack = [...next]
  for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
    if (hash === ancestor) return true
    if (seen.has(hash)) continue
    seen.add(hash)
    const entry = entries.get(hash)?.entry
    if (entry !== undefined && entry.clock.time > floor) stack.push(...entry.next)
  }
  return false
}
