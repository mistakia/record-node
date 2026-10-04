// Decoded duration (§6.4.1 step 4): the decoded sample count per channel over
// the sample rate, a function of the audio alone rather than of the
// container's header. ffmpeg decodes the first audio stream to mono 16-bit
// PCM, which keeps the per-channel sample count, and the tool host counts the
// bytes as they stream, so a long mix is never held in memory.
import { IngestError } from '#types/ingest.ts';
import { run_tool_counting } from "./subprocess.js";
const BYTES_PER_SAMPLE = 2;
// The output stream line ffmpeg logs at info level: "Audio: pcm_s16le, 44100 Hz, mono".
const OUTPUT_RATE_PATTERN = /Audio: pcm_s16le[^,]*, (\d+) Hz/g;
export const decode_args = (file_path) => ['-hide_banner', '-nostdin', '-i', file_path, '-map', '0:a:0', '-vn', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
export const decoded_duration = async ({ file_path, toolchain }) => {
    const { stdout_bytes: bytes, stderr, exit_code } = await run_tool_counting({ command: toolchain.ffmpeg_path, args: decode_args(file_path) });
    if (exit_code !== 0)
        throw new IngestError('no_audio', `ffmpeg could not decode ${file_path}: ${stderr.trim().split('\n').at(-1) ?? `exit ${exit_code}`}`);
    const rate = Number([...stderr.matchAll(OUTPUT_RATE_PATTERN)].at(-1)?.[1]);
    if (!Number.isSafeInteger(rate) || rate <= 0)
        throw new IngestError('tool_failed', `ffmpeg reported no output sample rate for ${file_path}`);
    const samples = Math.floor(bytes / BYTES_PER_SAMPLE);
    if (samples === 0)
        throw new IngestError('invalid_duration', `${file_path} decodes to zero samples`);
    return samples / rate;
};
