// Tag stripping through ffmpeg (§6.2, §6.3.4).
import { IngestError } from '#types/ingest.ts';
import { run_tool } from "./subprocess.js";
// The §6.2.3 reference flags: audio streams only, stream copy with no
// re-encode, no encoder-version tag, no metadata.
export const STRIP_ARGS = ['-map', '0:a', '-codec:a', 'copy', '-bitexact', '-map_metadata', '-1'];
const QUIET_ARGS = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
const STREAM_PATTERN = /^\s*Stream #\d+:\d+\S*: (\w+):/gm;
// The stream kinds ffmpeg reports for a file, in order (Audio, Video, ...).
// ffmpeg exits non-zero here because no output is named; the listing is on stderr.
export const probe_stream_kinds = async ({ file_path, toolchain }) => {
    const { stderr } = await run_tool({ command: toolchain.ffmpeg_path, args: ['-hide_banner', '-nostdin', '-i', file_path] });
    return [...stderr.matchAll(STREAM_PATTERN)].map((match) => match[1]);
};
// Writes the tag-stripped copy of input_path to output_path, whose extension
// selects the container (the caller keeps the source's). The output is checked
// for non-audio streams, so embedded artwork never reaches the audio blob.
export const strip_tags = async ({ input_path, output_path, toolchain }) => {
    const { exit_code, stderr } = await run_tool({
        command: toolchain.ffmpeg_path,
        args: [...QUIET_ARGS, '-y', '-i', input_path, ...STRIP_ARGS, output_path]
    });
    if (exit_code !== 0) {
        throw new IngestError('tool_failed', `ffmpeg tag strip failed for ${input_path}: ${stderr.trim() || `exit ${exit_code}`}`);
    }
    const kinds = await probe_stream_kinds({ file_path: output_path, toolchain });
    if (kinds.length === 0)
        throw new IngestError('no_audio', `tag-stripped copy of ${input_path} has no audio stream`);
    const foreign = kinds.filter((kind) => kind !== 'Audio');
    if (foreign.length > 0) {
        throw new IngestError('non_audio_stream', `tag-stripped copy of ${input_path} carries ${foreign.join(', ')} streams`);
    }
};
