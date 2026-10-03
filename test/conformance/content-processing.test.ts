// Fingerprinting, tag stripping, metadata, ingest, and listens (§6). Ingest
// rules run src/ingest against fpcalc and ffmpeg on audio derived from the F7
// FLAC; track-id and listens rules run against src/entry and src/oplog. URL
// ingest (§6.4.2) resolves record-resolver's recorded fixtures through its
// fake yt-dlp, and downloads by transcoding the F7 audio.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { parseFile } from 'music-metadata'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string, is_cid_string } from '#encoding/cid.ts'
import { build_del_operation } from '#entry/operations.ts'
import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { decoded_duration } from '#ingest/duration.ts'
import { compute_fingerprint, FPCALC_ARGS, is_degenerate_fingerprint } from '#ingest/fingerprint.ts'
import { extract_metadata } from '#ingest/metadata.ts'
import { ingest_cid } from '#ingest/pipeline-cid.ts'
import { ingest_local_file } from '#ingest/pipeline-local.ts'
import { ingest_resolved_entry } from '#ingest/pipeline-url.ts'
import { run_tool } from '#ingest/subprocess.ts'
import { probe_stream_kinds } from '#ingest/tag-strip.ts'
import { verify_toolchain } from '#ingest/toolchain.ts'
import { append_entry } from '#oplog/dag.ts'
import { append_listen } from '#oplog/listens.ts'
import { IngestError } from '#types/ingest.ts'
import { ProtocolError } from '#types/errors.ts'
import {
  make_silence,
  make_tagged_copy,
  open_ingest_target,
  preflight_bypassed,
  recording_fpcalc,
  scratch_dir,
  stored_content,
  strip_to_bytes,
  toolchain
} from '#test/helpers/ingest.ts'
import { open_test_library } from '#test/helpers/library.ts'
import { fixture_download, fixture_resolver, YOUTUBE_FIXTURE, YOUTUBE_STREAM_URL, YOUTUBE_URL } from '#test/helpers/resolver.ts'
import { audio_pipeline_vector as f7 } from './vectors.ts'

const writer = generate_key_pair()
const TRACK_ID = compute_track_id('AQADtEmSaImS')
const dir = scratch_dir()
const tagged = await make_tagged_copy({ dir, title: 'Sweep', covers: ['red', 'blue'] })
const retagged = await make_tagged_copy({ dir, title: 'Other', covers: [] })

const ingest = async (file_path: string, options: { toolchain?: typeof toolchain } = {}) => {
  const target = await open_ingest_target()
  const track = await ingest_local_file({ file_path, target, toolchain: options.toolchain ?? toolchain })
  return { target, track, content: await stored_content({ target, cid: track.content_cid }) }
}

const recording_toolchain = async () => {
  const fpcalc = recording_fpcalc({ dir: scratch_dir() })
  return { fpcalc, toolchain: await verify_toolchain({ fpcalc_path: fpcalc.path, allow_version_mismatch: preflight_bypassed }) }
}

// Per-packet hashes of the audio stream, without decoding.
const packet_hashes = async (file_path: string) => {
  const { stdout } = await run_tool({
    command: toolchain.ffmpeg_path,
    args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file_path, '-map', '0:a', '-c', 'copy', '-f', 'framemd5', '-']
  })
  return stdout.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
}

const rejection = async (run: () => Promise<unknown>): Promise<IngestError> => {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(IngestError)
    return error as IngestError
  }
  throw new Error('expected an ingest rejection')
}

describe('content-processing', () => {
  test('§6.1.1 [MUST] fingerprints come from Chromaprint', async () => {
    expect(toolchain.fpcalc_version).toMatch(/^\d+\.\d+\.\d+/)
    expect(await compute_fingerprint({ file_path: f7.fixture_path, toolchain })).toBe(f7.fingerprint)
  })

  test('§6.1.2 [MUST] Chromaprint algorithm 2 is used', async () => {
    const { fpcalc, toolchain: recording } = await recording_toolchain()
    await compute_fingerprint({ file_path: f7.fixture_path, toolchain: recording })
    expect(fpcalc.calls()).toEqual([`-json -algorithm 2 ${f7.fixture_path}`])
  })

  test('§6.1.2 [MUST] no fingerprint-affecting parameter is overridden; only the binary path is configurable', async () => {
    const { fpcalc, toolchain: recording } = await recording_toolchain()
    await ingest(f7.fixture_path, { toolchain: recording })
    expect([...FPCALC_ARGS]).toEqual(['-json', '-algorithm', '2'])
    for (const call of fpcalc.calls()) expect(call).not.toMatch(/-length|-rate|-chunk|-overlap|-raw|-channels/)
    expect(Object.keys(toolchain).sort()).toEqual(['ffmpeg_path', 'ffmpeg_version', 'fpcalc_path', 'fpcalc_version'])
  })

  test('§6.1.2 [MUST] algorithm 2 is requested explicitly, whatever the tool default', async () => {
    const { fpcalc, toolchain: recording } = await recording_toolchain()
    await ingest(tagged, { toolchain: recording })
    expect(fpcalc.calls()).toHaveLength(1)
    expect(fpcalc.calls()[0]).toStartWith('-json -algorithm 2 ')
  })

  test('§6.1.2.1 [MUST] the fingerprint is identical regardless of tags, artwork, or container framing', async () => {
    const remuxed = join(dir, 'remuxed.mka')
    await run_tool({ command: toolchain.ffmpeg_path, args: ['-nostdin', '-loglevel', 'error', '-y', '-i', f7.fixture_path, '-c:a', 'copy', remuxed] })
    for (const file_path of [tagged, retagged, remuxed]) {
      expect(await compute_fingerprint({ file_path, toolchain })).toBe(f7.fingerprint)
    }
  })

  test('§6.1.2.1 [MUST] files with the same samples and different tags yield the same fingerprint and track id', async () => {
    const first = await ingest(tagged)
    const second = await ingest(retagged)
    expect(first.content.tags.title).toBe('Sweep')
    expect(second.content.tags.title).toBe('Other')
    expect(first.content.tags.acoustid_fingerprint).toBe(second.content.tags.acoustid_fingerprint)
    expect(first.track.track_id).toBe(f7.track_id)
    expect(second.track.track_id).toBe(f7.track_id)
  })

  test('§6.1.2.1 [MUST] tag-stripped audio is never fed to the fingerprinter', async () => {
    const { fpcalc, toolchain: recording } = await recording_toolchain()
    await ingest(tagged, { toolchain: recording })
    expect(fpcalc.calls()).toEqual([`-json -algorithm 2 ${tagged}`])
  })

  test('§6.1.3 [MUST] the fingerprint is the fpcalc string output', async () => {
    const { stdout } = await run_tool({ command: toolchain.fpcalc_path, args: ['-json', '-algorithm', '2', tagged] })
    const printed = (JSON.parse(stdout) as { fingerprint: string }).fingerprint
    expect(await compute_fingerprint({ file_path: tagged, toolchain })).toBe(printed)
    expect((await ingest(tagged)).content.tags.acoustid_fingerprint).toBe(printed)
  })

  test('§6.1.5 [MUST] sha256(fpcalc(tagged)) equals sha256(fpcalc(strip_tags(tagged)))', async () => {
    const stripped = join(dir, 'roundtrip.flac')
    writeFileSync(stripped, await strip_to_bytes({ file_path: tagged }))
    const before = compute_track_id(await compute_fingerprint({ file_path: tagged, toolchain }))
    const after = compute_track_id(await compute_fingerprint({ file_path: stripped, toolchain }))
    expect(after).toBe(before)
    expect(before).toBe(f7.track_id)
  })

  test('§6.2.1 [MUST] the tag-stripped copy is what gets uploaded', async () => {
    const { target, content } = await ingest(tagged)
    expect(content.hash).toBe(f7.audio_cid)
    const unstripped_cid = await create_memory_content_store().import_blob(tagged)
    expect(content.hash).not.toBe(unstripped_cid)
    expect(await target.content_store.has(unstripped_cid)).toBe(false)
    expect(content.size).toBe(readFileSync(f7.fixture_path).length)
  })

  test('§6.2.1 [MUST] tag stripping is deterministic, lossless, and byte-preserving', async () => {
    const first = await strip_to_bytes({ file_path: tagged })
    const second = await strip_to_bytes({ file_path: tagged })
    expect(second).toEqual(first)
    expect(first).toEqual(await strip_to_bytes({ file_path: retagged }))
    expect(first).toEqual(new Uint8Array(readFileSync(f7.fixture_path)))
  })

  test('§6.2.2 [MUST] tag stripping copies audio streams only', async () => {
    expect(await probe_stream_kinds({ file_path: tagged, toolchain })).toEqual(['Audio', 'Video', 'Video'])
    const stripped = join(dir, 'audio-only.flac')
    writeFileSync(stripped, await strip_to_bytes({ file_path: tagged }))
    expect(await probe_stream_kinds({ file_path: stripped, toolchain })).toEqual(['Audio'])
  })

  test('§6.2.2 [MUST] tag stripping preserves audio bytes exactly', async () => {
    const stripped = join(dir, 'preserved.flac')
    writeFileSync(stripped, await strip_to_bytes({ file_path: tagged }))
    const source_packets = await packet_hashes(tagged)
    expect(source_packets.length).toBeGreaterThan(0)
    expect(await packet_hashes(stripped)).toEqual(source_packets)
  })

  test('§6.2.2 [MUST] tag stripping removes all metadata', async () => {
    const stripped = join(dir, 'bare.flac')
    writeFileSync(stripped, await strip_to_bytes({ file_path: tagged }))
    expect((await parseFile(tagged)).common.title).toBe('Sweep')
    const { common, native } = await parseFile(stripped)
    expect([common.title, common.artist, common.album, common.picture]).toEqual([undefined, undefined, undefined, undefined])
    expect(Object.values(native).flat().filter(({ id }) => id !== 'vendor')).toEqual([])
  })

  test('§6.2.2 [MUST] tag stripping suppresses the encoder-version tag', async () => {
    expect(Buffer.from(readFileSync(tagged)).includes('Lavf')).toBe(true)
    const stripped = Buffer.from(await strip_to_bytes({ file_path: tagged }))
    expect(stripped.includes('Lavf')).toBe(false)
    expect(stripped.includes('Lavc')).toBe(false)
  })

  test('§6.3.1 [MUST] content.tags carries acoustid_fingerprint', async () => {
    expect((await ingest(f7.fixture_path)).content.tags.acoustid_fingerprint).toBe(f7.fingerprint)
  })

  test('§6.3.2 [MUST] missing format fields are omitted or null, never coerced to 0', async () => {
    const { content } = await ingest(f7.fixture_path)
    expect(content.tags).not.toContainKey('title')
    expect(content.tags).not.toContainKey('bpm')
    for (const value of [...Object.values(content.tags), ...Object.values(content.audio)]) expect(value).not.toBe(0)
    expect(content.audio.duration).toBe(f7.duration_seconds)
    expect(Number.isInteger(content.audio.bitrate)).toBe(true)
  })

  test('§6.3.3 [MUST] each artwork element is a CID', async () => {
    const { content, target } = await ingest(tagged)
    const { pictures } = await extract_metadata({ file_path: tagged, fingerprint: f7.fingerprint })
    expect(content.artwork).toHaveLength(2)
    expect((content.artwork as unknown[]).every(is_cid_string)).toBe(true)
    // Source order, one CID per picture.
    expect(content.artwork).toEqual(await Promise.all(pictures.map(({ data }) => target.content_store.import_blob(data))))
    expect(content.artwork[0]).not.toBe(content.artwork[1])
    for (const cid of content.artwork as string[]) expect(await target.content_store.is_pinned(cid)).toBe(true)
  })

  test('§6.3.3 [MUST] a file with no artwork yields an empty artwork array', async () => {
    expect((await ingest(f7.fixture_path)).content.artwork).toEqual([])
    expect((await ingest(retagged)).content.artwork).toEqual([])
  })

  test('§6.3.4 [MUST] artwork is not embedded in the tag-stripped audio', async () => {
    const { content, target } = await ingest(tagged)
    const audio = await target.content_store.get(content.hash)
    const stripped = join(dir, 'from-store.flac')
    writeFileSync(stripped, audio as Uint8Array)
    expect(await probe_stream_kinds({ file_path: stripped, toolchain })).toEqual(['Audio'])
    expect((await parseFile(stripped)).common.picture).toBeUndefined()
  })

  test('§6.4.1 [MUST] ingest is rejected on an empty fingerprint, fingerprinter error, or no decodable audio', async () => {
    const text = join(dir, 'notes.flac')
    writeFileSync(text, 'not audio\n')
    const video = join(dir, 'silent-video.mp4')
    await run_tool({ command: toolchain.ffmpeg_path, args: ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=1', '-t', '1', video] })
    const short = await make_silence({ dir, seconds: 0.1 })
    const target = await open_ingest_target()
    const codes = []
    for (const file_path of [text, video, short, join(dir, 'missing.flac')]) {
      codes.push((await rejection(() => ingest_local_file({ file_path, target, toolchain }))).code)
    }
    expect(codes.slice(0, 2)).toEqual(['no_audio', 'no_audio'])
    expect(codes[2]).toBe('empty_fingerprint')
    expect(['no_audio', 'tool_failed']).toContain(codes[3] as string)
    expect(target.oplog.entries.size).toBe(0)
  })

  test('§6.4.1 [MUST] sha256("") is never used as a fallback track id', () => {
    expect(() => compute_track_id('')).toThrow('an empty fingerprint has no track id')
  })

  test('§6.4.1 [MUST] the stored duration is the decoded duration, not the container\'s', async () => {
    const file_path = await zero_length_wav()
    // The header claims no samples; fpcalc and the decoder read them anyway.
    expect(await compute_fingerprint({ file_path, toolchain })).toBe(f7.fingerprint)
    expect((await extract_metadata({ file_path, fingerprint: f7.fingerprint })).audio).not.toContainKey('duration')
    const { content } = await ingest(file_path)
    expect(content.audio.duration).toBe(f7.duration_seconds)
  })

  test('§6.4.1 [MUST] ingest is rejected when the decoded sample count is zero', async () => {
    const empty = join(dir, 'empty.wav')
    await run_tool({ command: toolchain.ffmpeg_path, args: ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0', empty] })
    expect((await rejection(() => decoded_duration({ file_path: empty, toolchain }))).code).toBe('invalid_duration')
  })

  test('§6.4.1 [MUST] ingest is rejected when the fingerprint is degenerate (§6.1.6)', async () => {
    const tone = await make_silence({ dir, seconds: 10 })
    expect(is_degenerate_fingerprint(await compute_fingerprint({ file_path: tone, toolchain }))).toBe(true)
    const target = await open_ingest_target()
    expect((await rejection(() => ingest_local_file({ file_path: tone, target, toolchain }))).code).toBe('degenerate_fingerprint')
    expect(target.oplog.entries.size).toBe(0)
  })

  test('§6.4.1 [MUST] an ingest whose decoded duration differs by more than 30 s from the entry with its id is refused', async () => {
    // One rising signal at three lengths: past fpcalc's 120 s window they
    // share a fingerprint, and so a track id.
    const signal = async (seconds: number) => {
      const path = join(dir, `long-${seconds}s.flac`)
      await run_tool({
        command: toolchain.ffmpeg_path,
        args: ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='0.4*sin(2*PI*(110*t+3*t*t))':s=11025:d=${seconds}`, '-c:a', 'flac', path]
      })
      return path
    }
    const [mix, near, far] = await Promise.all([signal(130), signal(150), signal(170)])
    const target = await open_ingest_target()
    const first = await ingest_local_file({ file_path: mix, target, toolchain })
    expect(compute_track_id(await compute_fingerprint({ file_path: far, toolchain }))).toBe(first.track_id)
    // Within 30 s it is the same recording: the existing entry, nothing appended.
    expect(await ingest_local_file({ file_path: near, target, toolchain })).toEqual({ ...first, existing: true })
    const refused = await rejection(() => ingest_local_file({ file_path: far, target, toolchain }))
    expect(refused.code).toBe('track_id_collision')
    expect(refused.message).toContain(first.entry_hash)
    expect(target.oplog.entries.size).toBe(1)
  })

  test('§6.4.2 [MUST] the resolver url field is stripped before persistence', async () => {
    const [entry, ...rest] = await fixture_resolver(YOUTUBE_FIXTURE)(YOUTUBE_URL)
    expect(rest).toHaveLength(0)
    expect(entry?.url).toBe(YOUTUBE_STREAM_URL)
    const target = await open_ingest_target()
    const download = fixture_download()
    const track = await ingest_resolved_entry({
      entry: entry as NonNullable<typeof entry>,
      target,
      toolchain,
      find_by_source: () => undefined,
      download
    })
    expect(download.urls).toEqual([YOUTUBE_STREAM_URL])
    const content = await stored_content({ target, cid: track.content_cid })
    expect(content.resolver).toEqual([{ extractor: 'youtube', id: 'iODdvJGpfIA', ...pick_resolver_fields(entry) }])
    for (const field of ['url', 'ext', 'http_headers']) expect(content.resolver[0]).not.toHaveProperty(field)
    // Neither the content payload nor the signed entry carries the stream url.
    const entry_bytes = target.oplog.entries.get(track.entry_hash)?.bytes as Uint8Array
    const content_bytes = await target.content_store.get(track.content_cid) as Uint8Array
    for (const bytes of [entry_bytes, content_bytes]) expect(Buffer.from(bytes).includes(YOUTUBE_STREAM_URL)).toBe(false)
  })

  test('§6.4.2 [check] a source already in the library returns its track without a download', async () => {
    const [entry] = await fixture_resolver(YOUTUBE_FIXTURE)(YOUTUBE_URL)
    const target = await open_ingest_target()
    const download = fixture_download()
    const first = await ingest_resolved_entry({ entry: entry as NonNullable<typeof entry>, target, toolchain, find_by_source: () => undefined, download })
    const sources: Array<{ extractor: string, id: string }> = []
    const again = await ingest_resolved_entry({
      entry: entry as NonNullable<typeof entry>,
      target,
      toolchain,
      find_by_source: (source) => {
        sources.push(source)
        return { ...first, existing: true }
      },
      download
    })
    expect(sources).toEqual([{ extractor: 'youtube', id: 'iODdvJGpfIA', ...pick_resolver_fields(entry) }])
    expect(again).toEqual({ ...first, existing: true })
    expect(download.urls).toHaveLength(1)
    expect(target.oplog.entries.size).toBe(1)
  })

  test('§6.4.3 [MUST] CID ingest validates the §2.4.1 required fields before accepting', async () => {
    const { content } = await ingest(f7.fixture_path)
    const target = await open_ingest_target()
    const store = async (value: unknown) => {
      const bytes = encode_canonical(value)
      const cid = compute_cid_string(bytes)
      await target.content_store.put(cid, bytes)
      return cid
    }
    const { artwork: _artwork, ...without_artwork } = content
    for (const invalid of [without_artwork, { ...content, hash: 'not-a-cid' }, { ...content, tags: {} }, { ...content, resolver: undefined }]) {
      const cid = await store(JSON.parse(JSON.stringify(invalid)))
      await expect(ingest_cid({ content_cid: cid, target })).rejects.toBeInstanceOf(ProtocolError)
    }
    expect(target.oplog.entries.size).toBe(0)
    const track = await ingest_cid({ content_cid: await store(content), target })
    expect(track).toMatchObject({ track_id: f7.track_id, existing: false })
    expect(await ingest_cid({ content_cid: track.content_cid, target })).toMatchObject({ entry_hash: track.entry_hash, existing: true })
    expect(target.oplog.entries.size).toBe(1)
  })

  test('§6.5 [MUST] a listen write without trackId is rejected', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_listen({ oplog, track_id: '', address: oplog.chain.address, key_pair: writer })).toThrow('requires trackId')
    const listen = append_listen({ oplog, track_id: TRACK_ID, address: oplog.chain.address, key_pair: writer, timestamp: 1 })
    expect(listen.operation).toEqual({ trackId: TRACK_ID, address: oplog.chain.address, timestamp: 1 })
  })

  test('§6.5 [MUST] listen entries cannot be deleted', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    append_listen({ oplog, track_id: TRACK_ID, address: oplog.chain.address, key_pair: writer })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: TRACK_ID, type: 'track' }) }))
      .toThrow('accepts only listen writes')
    expect(oplog.entries.size).toBe(1)
  })
})

// The F7 audio as WAV with its data-chunk size zeroed: decoders read to end of
// file, but the declared length, and so the container duration, is unknown.
async function zero_length_wav (): Promise<string> {
  const path = join(dir, 'zero-length.wav')
  await run_tool({ command: toolchain.ffmpeg_path, args: ['-nostdin', '-loglevel', 'error', '-y', '-i', f7.fixture_path, path] })
  const bytes = readFileSync(path)
  const data = bytes.indexOf('data')
  bytes.writeUInt32LE(0, data + 4)
  writeFileSync(path, bytes)
  return path
}

// The optional §2.4.2 fields of a resolved entry, as the strip keeps them.
function pick_resolver_fields (entry: object | undefined): Record<string, unknown> {
  const fields = ['fulltitle', 'thumbnail', 'artist', 'alt_title', 'upload_date', 'webpage_url', 'duration']
  const record = { ...entry } as Record<string, unknown>
  return Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]))
}
