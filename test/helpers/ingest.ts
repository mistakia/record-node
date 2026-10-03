// Ingest fixtures: the verified toolchain, audio variants derived from the F7
// FLAC, a recording fpcalc wrapper, and an ingest target library.
//
// The toolchain preflight refuses unpinned ffmpeg and fpcalc. On a machine
// without the pins, RECORD_TOOLCHAIN_PREFLIGHT=bypass tolerates the mismatch;
// CI runs the pinned binaries without it.

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { decode_payload } from '#entry/payload.ts'
import { run_tool } from '#ingest/subprocess.ts'
import { strip_tags } from '#ingest/tag-strip.ts'
import { is_pinned_toolchain, verify_toolchain, type Toolchain } from '#ingest/toolchain.ts'
import type { TrackTarget } from '#ingest/put-track.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { open_test_library } from './library.ts'

export const preflight_bypassed = process.env.RECORD_TOOLCHAIN_PREFLIGHT === 'bypass'

export const toolchain: Toolchain = await verify_toolchain({ allow_version_mismatch: preflight_bypassed })

// True only on the pinned versions, where byte-level F7 regeneration holds.
export const toolchain_on_pin = is_pinned_toolchain(toolchain)

export const scratch_dir = (): string => mkdtempSync(join(tmpdir(), 'record-ingest-test-'))

const ffmpeg = async (args: string[]) => {
  const { exit_code, stderr } = await run_tool({ command: toolchain.ffmpeg_path, args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args] })
  if (exit_code !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${stderr}`)
}

// A 16x16 PNG made by ffmpeg, so the cover needs no committed binary.
export const make_cover = async ({ dir, color = 'red' }: { dir: string, color?: string }): Promise<string> => {
  const path = join(dir, `cover-${color}.png`)
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=16x16:d=1`, '-frames:v', '1', path])
  return path
}

// The F7 audio with tags and attached covers: the same samples, other framing.
export const make_tagged_copy = async ({ dir, title = 'Sweep', covers = ['red'] }: {
  dir: string
  title?: string
  covers?: readonly string[]
}): Promise<string> => {
  const path = join(dir, `tagged-${title}-${covers.join('-') || 'bare'}.flac`)
  const cover_paths = await Promise.all(covers.map((color) => make_cover({ dir, color })))
  const cover_args = cover_paths.flatMap((cover) => ['-i', cover])
  const cover_maps = cover_paths.flatMap((_, index) => ['-map', `${index + 1}`])
  await ffmpeg([
    '-i', audio_pipeline_vector.fixture_path, ...cover_args,
    '-map', '0:a', ...cover_maps, '-c:a', 'copy', '-c:v', 'png', '-disposition:v', 'attached_pic',
    '-metadata', `title=${title}`, '-metadata', 'artist=Tester', '-metadata', 'album=Vectors', path
  ])
  return path
}

export const make_silence = async ({ dir, seconds }: { dir: string, seconds: number }): Promise<string> => {
  const path = join(dir, `sine-${seconds}s.flac`)
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=44100`, '-c:a', 'flac', path])
  return path
}

// An fpcalc stand-in that logs its argument vector, one per line, then runs
// the real binary, so a test sees exactly what the pipeline asked for.
export const recording_fpcalc = ({ dir }: { dir: string }) => {
  const log_path = join(dir, 'fpcalc-calls.log')
  const wrapper_path = join(dir, 'fpcalc-recording')
  writeFileSync(log_path, '')
  writeFileSync(wrapper_path, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log_path}'\nexec '${toolchain.fpcalc_path}' "$@"\n`)
  chmodSync(wrapper_path, 0o755)
  const calls = () => readFileSync(log_path, 'utf8').split('\n').filter((line) => line !== '' && line !== '-version')
  return { path: wrapper_path, calls }
}

// A shell stand-in that prints one fixed version line.
export const fake_tool = ({ dir, name, version_line }: { dir: string, name: string, version_line: string }): string => {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\necho '${version_line}'\n`)
  chmodSync(path, 0o755)
  return path
}

export const open_ingest_target = async (): Promise<TrackTarget> => {
  const key_pair = generate_key_pair()
  const { oplog } = await open_test_library({ writers: [key_pair] })
  return { oplog, key_pair, content_store: create_memory_content_store() }
}

export const stored_content = async ({ target, cid }: { target: TrackTarget, cid: string }): Promise<Record<string, any>> => {
  const bytes = await target.content_store.get(cid)
  if (bytes === undefined) throw new Error(`content not stored: ${cid}`)
  return decode_payload(bytes) as Record<string, any>
}

// The tag-stripped bytes of a file, through src/ingest.
export const strip_to_bytes = async ({ file_path, dir = scratch_dir() }: { file_path: string, dir?: string }): Promise<Uint8Array> => {
  const output_path = join(dir, `stripped-${Math.random().toString(36).slice(2)}${extname(file_path)}`)
  await strip_tags({ input_path: file_path, output_path, toolchain })
  return readFileSync(output_path)
}
