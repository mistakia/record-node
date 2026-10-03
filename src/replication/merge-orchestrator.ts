// Merge orchestration (§5.4.3): fetched entries wait until their transitive
// next closure is local or merge-ready, then merge in batches behind one
// per-library queue, so concurrent heads messages end in the state of some
// sequential merge order. An entry with an unfetched or abandoned ancestor
// never merges.

export interface MergeCandidate {
  readonly hash: string
  readonly entry: { readonly next: readonly string[] }
}

export interface MergeOrchestrator<T extends MergeCandidate> {
  add: (entry: T) => void
  // Fetched entries still waiting to merge.
  pending: () => number
  // Resolves once every scheduled merge has run.
  settled: () => Promise<void>
  discard: () => void
}

export const create_merge_orchestrator = <T extends MergeCandidate>({ is_landed, merge }: {
  is_landed: (hash: string) => boolean
  // Merges one batch whose every next is landed or in the same batch.
  merge: (entries: T[]) => Promise<void>
}): MergeOrchestrator<T> => {
  const fetched = new Map<string, T>()
  let tail: Promise<void> = Promise.resolve()
  let scheduled = false

  // Iterative, since a long chain would overflow a recursive walk. A cycle
  // leaves its members not ready.
  const ready_batch = (): T[] => {
    const ready = new Map<string, boolean>()
    for (const root of fetched.keys()) {
      const stack = [root]
      const on_path = new Set<string>()
      while (stack.length > 0) {
        const hash = stack[stack.length - 1] as string
        const entry = fetched.get(hash)
        if (ready.has(hash) || is_landed(hash) || entry === undefined) {
          if (!ready.has(hash)) ready.set(hash, is_landed(hash))
          stack.pop()
        } else if (!on_path.has(hash)) {
          on_path.add(hash)
          for (const parent of entry.entry.next) {
            if (!ready.has(parent) && !on_path.has(parent)) stack.push(parent)
          }
        } else {
          ready.set(hash, entry.entry.next.every((parent) => ready.get(parent) === true))
          on_path.delete(hash)
          stack.pop()
        }
      }
    }
    return [...fetched.values()].filter(({ hash }) => ready.get(hash) === true)
  }

  const run = async () => {
    scheduled = false
    const batch = ready_batch()
    if (batch.length === 0) return
    for (const { hash } of batch) fetched.delete(hash)
    try {
      await merge(batch)
    } catch (error) {
      // Kept for the next run rather than lost to the traversal, which never
      // fetches an entry twice.
      for (const entry of batch) fetched.set(entry.hash, entry)
      throw error
    }
  }

  return {
    add: (entry) => {
      fetched.set(entry.hash, entry)
      if (scheduled) return
      scheduled = true
      tail = tail.then(run).catch((error: unknown) => {
        process.emitWarning(`replication merge failed: ${(error as Error).message}`)
      })
    },
    pending: () => fetched.size,
    settled: async () => {
      for (let current = tail; ; current = tail) {
        await current
        if (current === tail) return
      }
    },
    discard: () => { fetched.clear() }
  }
}
