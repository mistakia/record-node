// Capabilities, revocation, and clock verification (§3.5.5 to §3.5.10, §4.2),
// against src/access-control and src/oplog, through the F10 vector.

import { describe, expect, test } from 'bun:test'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { build_put_operation } from '#entry/operations.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { in_causal_past } from '#oplog/causal.ts'
import { append_entry, create_oplog, MAX_CITED_HEADS, type Oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import type { LibraryType } from '#types/library.ts'
import { content_cid_of } from '#test/helpers/library.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'
import { build_capability_vector, LIBRARY_ADDRESSES, OWNER_KEY, type Verdict } from './capability-vector.ts'
import { capability_vector } from './vectors.ts'

const open_owner_libraries = async (): Promise<Record<LibraryType, Oplog>> => {
  const block_store = create_memory_block_store()
  const open = async (type: LibraryType, name: string) => {
    const { address } = await create_ac_chain({ name, type, write_keys: [OWNER_KEY.public_key], block_store })
    expect(address).toBe(LIBRARY_ADDRESSES[type])
    return create_oplog({ chain: await resolve_ac_chain({ library_address: address, block_store }) })
  }
  return { recordstore: await open('recordstore', 'library'), listens: await open('listens', 'listens'), identity: await open('identity', 'identity') }
}

// Merges every case into its library in one batch and reads each verdict back.
const run_vector = async () => {
  const vector = build_capability_vector()
  const oplogs = await open_owner_libraries()
  const verdicts = new Map<string, Verdict>()
  for (const type of ['recordstore', 'listens', 'identity'] as const) {
    const oplog = oplogs[type]
    const blocks = vector.cases.filter(({ library }) => library === type).map(({ hashed }) => hashed.bytes)
    const { merged, rejected } = merge_entries({ oplog, blocks })
    for (const { hash } of merged) verdicts.set(hash, oplog.inert.has(hash) ? 'inert' : 'accept')
    for (const { hash, error } of rejected) verdicts.set(hash, error.code)
  }
  return { ...vector, oplog: oplogs.recordstore, verdicts }
}

const result = await run_vector()

describe('capabilities', () => {
  test('§3.5.10 [vector] F10 capability C, write W, and revocation R hash to the spec values', () => {
    expect(result.cases.length).toBe(capability_vector.case_count)
    expect(result.hashes.C).toBe(capability_vector.C)
    expect(result.hashes.W).toBe(capability_vector.W)
    expect(result.hashes.R).toBe(capability_vector.R)
  })

  for (const { label, hashed, verdict } of result.cases.filter(({ label }) => !label.startsWith('spam '))) {
    test(`§3.5.9 [vector] F10 ${label}: ${verdict}`, () => {
      expect(result.verdicts.get(hashed.hash)).toBe(verdict)
    })
  }

  test('§4.2 [vector] F10 a grantee leaving 257 heads: every spam entry is accepted', () => {
    const spam = result.cases.filter(({ label }) => label.startsWith('spam '))
    expect(spam.length).toBe(257)
    expect(spam.filter(({ hashed }) => result.verdicts.get(hashed.hash) !== 'accept')).toEqual([])
  })

  test('§3.5.10 [vector] F10 the effective revocations are R, RE, DR, RA, and RB', () => {
    const { R, RE, DR, RA, RB } = result.hashes
    expect([...result.oplog.effective].sort()).toEqual([R, RE, DR, RA, RB].sort())
  })

  test('§4.2 [vector] F10 the fan-out branch converges to one head after O2', () => {
    const { oplog, hashes: { SP, O2 } } = result
    const branch_heads = [...oplog.heads].filter((hash) => hash === SP || in_causal_past({ entries: oplog.entries, ancestor: SP, next: [hash] }))
    expect(branch_heads).toEqual([O2])
  })

  test('§4.5 [MUST] merging the vector one entry at a time in clock order reaches the same state, inert entries included', async () => {
    const replica = (await open_owner_libraries()).recordstore
    const ordered = result.cases.filter(({ library }) => library === 'recordstore').map(({ hashed }) => hashed)
      .sort((a, b) => a.entry.clock.time - b.entry.clock.time)
    for (const hashed of ordered) merge_entries({ oplog: replica, blocks: [hashed.bytes] })
    expect([...replica.entries.keys()].sort()).toEqual([...result.oplog.entries.keys()].sort())
    expect([...replica.inert].sort()).toEqual([...result.oplog.inert].sort())
    expect([...replica.effective].sort()).toEqual([...result.oplog.effective].sort())
    expect([...replica.current].map(([key, { hash }]) => [key, hash]).sort()).toEqual([...result.oplog.current].map(([key, { hash }]) => [key, hash]).sort())
  })

  test('§4.4.2 [MUST] an inert entry takes no part in current-state resolution', () => {
    const { oplog } = result
    const inert_tracks = [...oplog.inert].map((hash) => oplog.entries.get(hash)).filter((entry) => entry?.state_key !== undefined)
    expect(inert_tracks.length).toBeGreaterThan(0)
    for (const entry of inert_tracks) expect(oplog.current.get(entry?.state_key as string)?.hash).not.toBe(entry?.hash as string)
  })
})

describe('clock', () => {
  test('§4.2 [MUST] an append cites at most 256 heads, greatest clock.time first, and converges to one head', async () => {
    const vector = build_capability_vector()
    const oplog = (await open_owner_libraries()).recordstore
    const { SP } = vector.hashes
    const branch = vector.cases.filter(({ hashed, label }) => hashed.hash === SP || label.startsWith('spam ')).map(({ hashed }) => hashed.bytes)
    merge_entries({ oplog, blocks: branch })
    expect(oplog.heads.size).toBe(257)
    const append = (n: number) => append_entry({
      oplog,
      key_pair: OWNER_KEY,
      payload: build_put_operation({ envelope: build_track_envelope({ id: sha256_hex(`owner-${n}`), content_cid: content_cid_of({ n }) }) })
    })
    const first = append(1)
    expect(first.entry.next.length).toBe(MAX_CITED_HEADS)
    expect(oplog.heads.size).toBe(2)
    const second = append(2)
    expect(second.entry.next.length).toBe(2)
    expect([...oplog.heads]).toEqual([second.hash])
  })

  test('§4.2 [MUST] an entry whose clock.time is not one more than its next is rejected', async () => {
    const oplog = (await open_owner_libraries()).recordstore
    const forged = build_capability_vector().cases.find(({ label }) => label.includes('forged clock.time'))
    if (forged === undefined) throw new Error('the vector has a forged-clock case')
    const parents = build_capability_vector().cases.filter(({ hashed }) => forged.hashed.entry.next.includes(hashed.hash)).map(({ hashed }) => hashed.bytes)
    const { rejected } = merge_entries({ oplog, blocks: [...parents, forged.hashed.bytes] })
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_clock'])
  })

  test('§5.4.2 [MUST] an entry whose next is not in hand is rejected, and so is every descendant', async () => {
    const vector = build_capability_vector()
    const oplog = (await open_owner_libraries()).recordstore
    const { C, W, R } = vector.hashes
    const block = (hash: string | undefined) => vector.cases.find(({ hashed }) => hashed.hash === hash)?.hashed.bytes as Uint8Array
    const { merged, rejected } = merge_entries({ oplog, blocks: [block(W), block(R)] })
    expect(merged).toEqual([])
    expect(rejected.map(({ hash }) => hash)).toEqual([W, R])
    expect(merge_entries({ oplog, blocks: [block(C), block(W), block(R)] }).merged.length).toBe(3)
  })
})
