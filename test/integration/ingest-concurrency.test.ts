// Ingest concurrency: prepares (fingerprint, decode, tag strip, blob import)
// run beside each other up to ingest_prepare_concurrency, commits stay one at
// a time, and a commit that refuses or finds the track already there leaves
// no pin behind.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { is_put } from '#entry/operations.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { stored_track_content, track_blobs } from '#peer/pins.ts'
import { run_tool } from '#ingest/subprocess.ts'
import { preflight_bypassed, scratch_dir, toolchain } from '#test/helpers/ingest.ts'

const running: Peer[] = []
afterEach(async () => { for (const peer of running.splice(0)) await stop_peer(peer) })

// An fpcalc that logs when each run starts and ends, and holds each run open
// long enough for overlapping runs to show.
const slow_fpcalc = (dir: string) => {
  const log = join(dir, 'fpcalc-spans.log')
  const path = join(dir, 'fpcalc-slow')
  writeFileSync(log, '')
  writeFileSync(path, `#!/bin/sh
case "$1" in -version) exec '${toolchain.fpcalc_path}' "$@";; esac
echo "+" >> '${log}'
sleep 0.4
'${toolchain.fpcalc_path}' "$@"
status=$?
echo "-" >> '${log}'
exit $status
`)
  chmodSync(path, 0o755)
  // The most runs that were open at once.
  const peak = () => readFileSync(log, 'utf8').split('\n').reduce(({ open, max }, line) =>
    line === '+' ? { open: open + 1, max: Math.max(max, open + 1) } : line === '-' ? { open: open - 1, max } : { open, max }, { open: 0, max: 0 }).max
  return { path, peak }
}

const rising_tone = async (dir: string, { base, seconds }: { base: number, seconds: number }) => {
  const path = join(dir, `tone-${base}-${seconds}.flac`)
  await run_tool({
    command: toolchain.ffmpeg_path,
    args: ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='0.4*sin(2*PI*(${base}*t+3*t*t))':s=11025:d=${seconds}`, '-c:a', 'flac', path]
  })
  return path
}

const start = async (config: Record<string, unknown>) => {
  const peer = await create_peer({ config: { allow_toolchain_mismatch: preflight_bypassed, network: false, ...config } })
  await start_peer(peer)
  running.push(peer)
  return peer
}

describe('ingest concurrency', () => {
  test('prepares of separate ingests run at once, up to ingest_prepare_concurrency, and every track commits', async () => {
    const dir = scratch_dir()
    const fpcalc = slow_fpcalc(dir)
    const files = await Promise.all([110, 160, 210, 260].map(async (base) => await rising_tone(dir, { base, seconds: 8 })))
    const peer = await start({ fpcalc_path: fpcalc.path, ingest_prepare_concurrency: 2 })
    const tracks = await Promise.all(files.map(async (file) => await peer.ingest_file(file)))
    expect(new Set(tracks.map(({ track_id }) => track_id)).size).toBe(4)
    expect(tracks.every(({ existing }) => !existing)).toBe(true)
    expect(fpcalc.peak()).toBe(2)
    expect((await peer.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' })).total).toBe(4)
  })

  test('a collision found at commit leaves no pin its prepare made', async () => {
    const dir = scratch_dir()
    // One signal at two lengths past fpcalc's window: one track id, two recordings.
    const [short, long] = await Promise.all([rising_tone(dir, { base: 120, seconds: 130 }), rising_tone(dir, { base: 120, seconds: 170 })])
    const peer = await start({})
    const pinned: string[] = []
    const pin = peer.content_store.pin
    peer.content_store.pin = async (cid, options) => {
      if (options?.recursive === true) pinned.push(cid)
      await pin(cid, options)
    }
    const results = await Promise.allSettled([peer.ingest_file(short as string), peer.ingest_file(long as string)])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect((refused?.reason as { code?: string }).code).toBe('track_id_collision')
    // Every recursive pin still standing belongs to the committed track.
    const own = peer.context.libraries.get(peer.identity().own_address)
    const kept = new Set<string>()
    for (const entry of own?.oplog.current.values() ?? []) {
      if (!is_put(entry.operation)) continue
      const content = await stored_track_content({ content_store: peer.content_store, content_cid: entry.operation.value.content })
      if (content !== undefined) for (const cid of track_blobs(content)) kept.add(cid)
    }
    for (const cid of pinned) expect(await peer.content_store.is_pinned(cid)).toBe(kept.has(cid))
  })

  test('stop lets a prepare in flight commit, then refuses new ingests', async () => {
    const dir = scratch_dir()
    const fpcalc = slow_fpcalc(dir)
    const file = await rising_tone(dir, { base: 300, seconds: 6 })
    const peer = await create_peer({ config: { allow_toolchain_mismatch: preflight_bypassed, network: false, fpcalc_path: fpcalc.path } })
    await start_peer(peer)
    const ingest = peer.ingest_file(file)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const stopped = stop_peer(peer)
    expect(await ingest).toMatchObject({ existing: false })
    await stopped
    await expect(peer.ingest_file(file)).rejects.toThrow('stopping')
  })
})
