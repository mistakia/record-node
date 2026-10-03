// Decoded duration (§6.4.1 step 4): the decoded sample count per channel over
// the sample rate, a function of the audio alone rather than of the
// container's header. ffmpeg decodes the first audio stream to mono 16-bit
// PCM, which keeps the per-channel sample count, and the bytes are counted as
// they stream, so a long mix is never held in memory.
import { spawn } from 'node:child_process';
import { IngestError } from '#types/ingest.ts';
const BYTES_PER_SAMPLE = 2;
const STDERR_LIMIT_BYTES = 64 * 1024;
// The output stream line ffmpeg logs at info level: "Audio: pcm_s16le, 44100 Hz, mono".
const OUTPUT_RATE_PATTERN = /Audio: pcm_s16le[^,]*, (\d+) Hz/g;
export const decode_args = (file_path) => ['-hide_banner', '-nostdin', '-i', file_path, '-map', '0:a:0', '-vn', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
export const decoded_duration = async ({ file_path, toolchain }) => {
    const { bytes, stderr, exit_code } = await new Promise((resolve, reject) => {
        const child = spawn(toolchain.ffmpeg_path, decode_args(file_path), { stdio: ['ignore', 'pipe', 'pipe'] });
        let bytes = 0;
        let stderr = '';
        child.stdout.on('data', (chunk) => { bytes += chunk.length; });
        child.stderr.on('data', (chunk) => { if (stderr.length < STDERR_LIMIT_BYTES)
            stderr += chunk.toString('utf8'); });
        child.on('error', (error) => { reject(new IngestError('toolchain_unavailable', `cannot run ${toolchain.ffmpeg_path}: ${error.message}`)); });
        child.on('close', (code) => { resolve({ bytes, stderr, exit_code: code ?? 1 }); });
    });
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
