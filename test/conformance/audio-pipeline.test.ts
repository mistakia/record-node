// F7 (§6.1.5, §6.2.4, §6.4.1) end to end through src/ingest: the toolchain
// preflight, the sine-sweep regeneration, fingerprint, track id, tag strip,
// and the audio CID on both store backends.
//
// The regeneration check compares decoded samples, not file bytes: the FLAC
// encoder's frame bytes vary with CPU code paths across machines even at the
// pinned version (the cross-machine residual risk of fixtures/README.md), while
// the synthesized samples do not. A different ffmpeg version changes them.
//
// The preflight and regeneration checks hold only on the pinned ffmpeg and
// fpcalc. Under RECORD_TOOLCHAIN_PREFLIGHT=bypass on an unpinned machine they
// skip; CI runs the pinned binaries with no bypass.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { describe, expect, test } from 'bun:test'

import { create_helia_content_store } from '#adapter/libp2p/content-store.ts'
import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { compute_track_id } from '#entry/id.ts'
import { compute_fingerprint } from '#ingest/fingerprint.ts'
import { ingest_local_file } from '#ingest/pipeline-local.ts'
import { run_tool } from '#ingest/subprocess.ts'
import { PINNED_FFMPEG_VERSION, PINNED_FPCALC_VERSION } from '#ingest/toolchain.ts'
import { create_offline_helia } from '#test/helpers/helia.ts'
import {
  open_ingest_target,
  preflight_bypassed,
  scratch_dir,
  stored_content,
  strip_to_bytes,
  toolchain,
  toolchain_on_pin
} from '#test/helpers/ingest.ts'
import { audio_pipeline_vector as f7 } from './vectors.ts'

// The generator's synthesis flags (gen-audio-pipeline-smoke.mjs SINE_FLAGS).
const SINE_ARGS = [
  '-y', '-hide_banner', '-nostdin', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5:sample_rate=44100',
  '-bitexact', '-c:a', 'flac', '-map_metadata', '-1'
]

// sha256 of the decoded 16-bit PCM, read from a file ffmpeg writes.
const decoded_sample_digest = async (file_path: string): Promise<string> => {
  const pcm_path = join(scratch_dir(), 'samples.pcm')
  const { exit_code, stderr } = await run_tool({
    command: toolchain.ffmpeg_path,
    args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', file_path, '-f', 's16le', pcm_path]
  })
  if (exit_code !== 0) throw new Error(`ffmpeg could not decode ${file_path}: ${stderr}`)
  return bytesToHex(sha256(readFileSync(pcm_path)))
}

describe('F7 audio pipeline', () => {
  test.skipIf(preflight_bypassed)('preflight: ffmpeg and fpcalc are the pinned versions', () => {
    expect(toolchain.ffmpeg_version).toStartWith(PINNED_FFMPEG_VERSION)
    expect(toolchain.fpcalc_version).toStartWith(PINNED_FPCALC_VERSION)
    expect(toolchain_on_pin).toBe(true)
  })

  test.skipIf(!toolchain_on_pin)('the pinned ffmpeg regenerates the samples of the committed sine sweep', async () => {
    const regenerated = join(scratch_dir(), 'sine.flac')
    const { exit_code, stderr } = await run_tool({ command: toolchain.ffmpeg_path, args: [...SINE_ARGS, regenerated] })
    expect(stderr).toBe('')
    expect(exit_code).toBe(0)
    const committed = await decoded_sample_digest(f7.fixture_path)
    expect(await decoded_sample_digest(regenerated)).toBe(committed)
  })

  test('fingerprint and track id', async () => {
    const fingerprint = await compute_fingerprint({ file_path: f7.fixture_path, toolchain })
    expect(fingerprint).toBe(f7.fingerprint)
    expect(compute_track_id(fingerprint)).toBe(f7.track_id)
  })

  test('tag-stripped bytes and their audio CID on both store backends', async () => {
    const stripped = await strip_to_bytes({ file_path: f7.fixture_path })
    expect(bytesToHex(sha256(stripped))).toBe(f7.audio_identity_sha256)
    expect(await create_memory_content_store().import_blob(stripped)).toBe(f7.audio_cid)
    const helia = await create_offline_helia()
    try {
      expect(await create_helia_content_store({ helia }).import_blob(stripped)).toBe(f7.audio_cid)
    } finally {
      await helia.stop()
    }
  })

  test('ingest_local_file yields the F7 track id and content.hash, pinned', async () => {
    const target = await open_ingest_target()
    const track = await ingest_local_file({ file_path: f7.fixture_path, target, toolchain, timestamp: 1 })
    expect(track).toMatchObject({ track_id: f7.track_id, existing: false })
    const content = await stored_content({ target, cid: track.content_cid })
    expect(content).toMatchObject({ hash: f7.audio_cid, size: 68127, artwork: [], resolver: [] })
    for (const cid of [f7.audio_cid, track.content_cid, track.entry_hash]) {
      expect(await target.content_store.is_pinned(cid)).toBe(true)
    }
    // A second ingest finds the live entry and appends nothing (§6.4.1 step 3).
    expect(await ingest_local_file({ file_path: f7.fixture_path, target, toolchain })).toEqual({ ...track, existing: true })
    expect(target.oplog.entries.size).toBe(1)
  })
})
