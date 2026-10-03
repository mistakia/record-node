// Entry DAGs of one library, as a remote peer would serve them: a linear
// chain, or a fan-in of concurrent branches under one top entry, with every
// signed block keyed by its hash for a fetch to read.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { generate_key_pair, type KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { create_oplog, type Oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { verify_fetched } from '#replication/replicator.ts'
import { create_traversal } from '#replication/traversal.ts'
import { SYSTEM_TIMERS, type Timers } from '#replication/timers.ts'
import { append_track, open_test_library } from './library.ts'

export interface Dag {
  readonly chain: ResolvedAcChain
  readonly writer: KeyPair
  readonly source: Oplog
  readonly blocks: ReadonlyMap<string, Uint8Array>
  readonly entries: readonly VerifiedEntry[]
}

const dag_of = ({ chain, writer, source }: { chain: ResolvedAcChain, writer: KeyPair, source: Oplog }): Dag => ({
  chain,
  writer,
  source,
  blocks: new Map([...source.entries.values()].map(({ hash, bytes }) => [hash, bytes])),
  entries: [...source.entries.values()]
})

// e0 <- e1 <- ... <- e(length-1); entries[i] is e(i).
export const linear_dag = async (length: number): Promise<Dag> => {
  const writer = generate_key_pair()
  const { chain, oplog: source } = await open_test_library({ writers: [writer] })
  for (let index = 0; index < length; index++) append_track({ oplog: source, key_pair: writer, fingerprint: `AQADlinear${index}` })
  return dag_of({ chain, writer, source })
}

// `width` single-entry branches, each a head until a top entry names them all.
export const fan_in_dag = async (width: number): Promise<Dag & { top: VerifiedEntry, branches: VerifiedEntry[] }> => {
  const writer = generate_key_pair()
  const { chain, oplog: source } = await open_test_library({ writers: [writer] })
  const branches = Array.from({ length: width }, (_, index) => {
    const fork = create_oplog({ chain })
    return append_track({ oplog: fork, key_pair: writer, fingerprint: `AQADbranch${index}` })
  })
  merge_entries({ oplog: source, blocks: branches.map(({ bytes }) => bytes) })
  const top = append_track({ oplog: source, key_pair: writer, fingerprint: 'AQADtop' })
  return { ...dag_of({ chain, writer, source }), top, branches }
}

// A traversal over the DAG's chain, reading blocks from `fetch`, with what it
// verified collected in order.
export const traverse = ({ chain, fetch, concurrency = 4, timeout_ms = 5000, landed = new Set<string>(), timers = SYSTEM_TIMERS }: {
  chain: ResolvedAcChain
  fetch: (hash: string, options: { signal: AbortSignal }) => Promise<Uint8Array | undefined>
  concurrency?: number
  timeout_ms?: number
  landed?: Set<string>
  timers?: Timers
}) => {
  const verified: VerifiedEntry[] = []
  const fetches: string[] = []
  const traversal = create_traversal({
    fetch: async (hash, options) => {
      fetches.push(hash)
      return await fetch(hash, options)
    },
    verify: verify_fetched(chain),
    is_landed: (hash) => landed.has(hash),
    on_entry: (entry) => { verified.push(entry) },
    concurrency,
    timeout_ms,
    timers
  })
  return { traversal, verified, fetches }
}

// The item at index, which the test knows exists.
export const nth = <T>(items: readonly T[], index: number): T => {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

// A fetch that never answers on its own: it resolves undefined on abort.
export const hanging_fetch = async (_hash: string, { signal }: { signal: AbortSignal }): Promise<Uint8Array | undefined> =>
  await new Promise((resolve) => { signal.addEventListener('abort', () => { resolve(undefined) }) })
