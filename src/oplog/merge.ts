// Merging remote entries (§4.5). Merge is set union over verified entries
// plus total-order resolution per key, so it is associative and commutative.

import { decode_signed_entry } from '#entry/signed.ts'
import { is_operation } from '#entry/operations.ts'
import { ProtocolError } from '#types/errors.ts'
import { verify_entry, type VerifiedEntry } from './accept.ts'
import { merge_clock_time } from './clock.ts'
import { insert_entry, refresh_current_state, type Oplog } from './dag.ts'

export interface MergeResult {
  readonly merged: readonly VerifiedEntry[]
  readonly rejected: readonly ProtocolError[]
}

const verify_block = ({ oplog, bytes }: { oplog: Oplog, bytes: Uint8Array }): VerifiedEntry | ProtocolError => {
  try {
    return verify_entry({ hashed: decode_signed_entry(bytes), chain: oplog.chain })
  } catch (error) {
    if (error instanceof ProtocolError) return error
    throw error
  }
}

// Takes signed-entry blocks as fetched, so size and canonical-form checks
// run before decoding is trusted and before any signature work.
export const merge_entries = ({ oplog, blocks }: { oplog: Oplog, blocks: readonly Uint8Array[] }): MergeResult => {
  // Step 1: an entry that fails verification is dropped.
  const results = blocks.map((bytes) => verify_block({ oplog, bytes }))
  const rejected = results.filter((result) => result instanceof ProtocolError)
  const verified = results.filter((result): result is VerifiedEntry => !(result instanceof ProtocolError))
  // Steps 2 and 4: idempotent insertion keeps heads equal to heads(E_local ∪ E_remote).
  const merged = verified.filter((entry) => insert_entry({ oplog, entry }))
  // Step 3: advance the Lamport clock.
  oplog.clock_time = merge_clock_time({
    local_time: oplog.clock_time,
    remote_times: merged.map(({ entry }) => entry.clock.time)
  })
  // Step 5: re-resolve every touched key over all of its known entries.
  const keys = new Set(merged.flatMap(({ operation }) => is_operation(operation) ? [operation.key] : []))
  refresh_current_state({ oplog, keys })
  return { merged, rejected }
}
