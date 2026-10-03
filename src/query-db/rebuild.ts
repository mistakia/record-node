// Full rebuild of the query index by replay (§4.7): drop every table, merge
// each library's stored entry blocks into a fresh oplog, and project the
// result. Rebuild and incremental maintenance share the projector, and the
// rows they produce are the same.

import type { DatabaseSync } from 'node:sqlite'

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { create_oplog, type Oplog } from '#oplog/dag.ts'
import { merge_entries, type MergeResult } from '#oplog/merge.ts'
import { create_projector, type ContentReader } from './projector.ts'
import { apply_schema, drop_schema } from './schema.ts'

export interface LibraryReplay {
  readonly chain: ResolvedAcChain
  // The library's signed-entry blocks, in any order.
  readonly blocks: Iterable<Uint8Array>
}

export interface RebuildResult {
  readonly oplogs: readonly Oplog[]
  // Stored blocks that failed verification and were left out of the replay.
  readonly rejected: MergeResult['rejected']
}

export const rebuild_query_db = async ({ db, libraries, read_content }: {
  db: DatabaseSync
  libraries: Iterable<LibraryReplay>
  read_content: ContentReader
}): Promise<RebuildResult> => {
  drop_schema(db)
  apply_schema(db)
  const projector = create_projector({ db, read_content })
  const oplogs: Oplog[] = []
  const rejected: Array<MergeResult['rejected'][number]> = []
  for (const { chain, blocks } of libraries) {
    const oplog = create_oplog({ chain })
    rejected.push(...merge_entries({ oplog, blocks: [...blocks] }).rejected)
    await projector.project_library({ oplog })
    oplogs.push(oplog)
  }
  return { oplogs, rejected }
}
