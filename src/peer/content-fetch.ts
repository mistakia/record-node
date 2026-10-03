// Content payloads of merged entries (§5.4.3): fetched from peers after the
// merge, pinned and re-indexed once they land. One that no peer serves yet is
// kept and retried when a peer joins the library topic or replication resumes.

import { is_put } from '#entry/operations.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { PeerContext } from './context.ts'

export interface ContentFetcher {
  fetch: (input: { library_address: string, entries: readonly VerifiedEntry[] }) => void
  retry_missing: (library_address: string) => void
  forget: (library_address: string) => void
  // Resolves once no fetch for the library is running.
  settled: (library_address: string) => Promise<void>
}

// Runs jobs with at most `limit` in flight.
const run_bounded = async <T>(items: readonly T[], limit: number, job: (item: T) => Promise<void>): Promise<void> => {
  const queue = [...items]
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await job(item)
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
}

export const create_content_fetcher = ({ context, get_block }: {
  context: PeerContext
  get_block: (cid: string) => Promise<Uint8Array | undefined>
}): ContentFetcher => {
  const { config, content_store, libraries } = context
  const missing = new Map<string, Map<string, VerifiedEntry>>()
  const jobs = new Map<string, Set<Promise<void>>>()

  const fetch_all = async (library_address: string, entries: readonly VerifiedEntry[]) => {
    const arrived: VerifiedEntry[] = []
    const waiting = missing.get(library_address) ?? new Map<string, VerifiedEntry>()
    missing.set(library_address, waiting)
    await run_bounded(entries, config.traversal_concurrency, async (entry) => {
      if (!is_put(entry.operation) || await content_store.has(entry.operation.value.content)) return
      if (await get_block(entry.operation.value.content) === undefined) waiting.set(entry.hash, entry)
      else arrived.push(entry)
    })
    for (const { hash } of arrived) waiting.delete(hash)
    if (arrived.length > 0 && libraries.get(library_address) !== undefined) await libraries.reindex({ library_address, entries: arrived })
  }

  const fetch: ContentFetcher['fetch'] = ({ library_address, entries }) => {
    const running = jobs.get(library_address) ?? new Set()
    jobs.set(library_address, running)
    const job = fetch_all(library_address, entries)
    running.add(job)
    job.catch((error: unknown) => { process.emitWarning(`content fetch for ${library_address} failed: ${(error as Error).message}`) })
      .finally(() => { running.delete(job) })
  }

  return {
    fetch,
    retry_missing: (library_address) => {
      const waiting = missing.get(library_address)
      if (waiting !== undefined && waiting.size > 0) fetch({ library_address, entries: [...waiting.values()] })
    },
    forget: (library_address) => { missing.delete(library_address) },
    settled: async (library_address) => {
      for (;;) {
        const running = [...(jobs.get(library_address) ?? [])]
        if (running.length === 0) return
        await Promise.allSettled(running)
      }
    }
  }
}
