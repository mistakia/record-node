// Decoded audio (§6.4.1 step 4): the decoded sample count per channel and
// the sample rate, a function of the audio alone rather than of the
// container's header. ffmpeg decodes the first audio stream to mono 16-bit
// PCM, which keeps the per-channel sample count, and the tool host counts the
// bytes as they stream, so a long mix is never held in memory.

import { IngestError } from '#types/ingest.ts'
import { run_tool_counting } from './subprocess.ts'
import type { Toolchain } from './toolchain.ts'

const BYTES_PER_SAMPLE = 2
// The output stream line ffmpeg logs at info level: "Audio: pcm_s16le, 44100 Hz, mono".
const OUTPUT_RATE_PATTERN = /Audio: pcm_s16le[^,]*, (\d+) Hz/g

export interface DecodedAudio {
  readonly samples: number
  readonly rate: number
}

// The fields of content.audio that §6.3.2 derives from the decoded audio.
export interface DecodedFields {
  readonly duration: number
  readonly numberOfSamples: number
  readonly bitrate: number
}

export const decode_args = (file_path: string): string[] =>
  ['-hide_banner', '-nostdin', '-i', file_path, '-map', '0:a:0', '-vn', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']

export const decode_audio = async ({ file_path, toolchain }: { file_path: string, toolchain: Toolchain }): Promise<DecodedAudio> => {
  const { stdout_bytes: bytes, stderr, exit_code } = await run_tool_counting({ command: toolchain.ffmpeg_path, args: decode_args(file_path) })
  if (exit_code !== 0) throw new IngestError('no_audio', `ffmpeg could not decode ${file_path}: ${stderr.trim().split('\n').at(-1) ?? `exit ${exit_code}`}`)
  const rate = Number([...stderr.matchAll(OUTPUT_RATE_PATTERN)].at(-1)?.[1])
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new IngestError('tool_failed', `ffmpeg reported no output sample rate for ${file_path}`)
  const samples = Math.floor(bytes / BYTES_PER_SAMPLE)
  if (samples === 0) throw new IngestError('invalid_duration', `${file_path} decodes to zero samples`)
  return { samples, rate }
}

export const decoded_seconds = ({ samples, rate }: DecodedAudio): number => samples / rate

// The bitrate is the average over the tag-stripped blob of size bytes, never
// a container's, which for a VBR MP3 without a VBR header is its first frame's.
export const decoded_fields = (decoded: DecodedAudio, size: number): DecodedFields => {
  const duration = decoded_seconds(decoded)
  return { duration, numberOfSamples: decoded.samples, bitrate: Math.round(size * 8 / duration) }
}
