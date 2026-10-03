// Chromaprint fingerprinting through fpcalc (§6.1).
import { IngestError } from '#types/ingest.ts';
import { run_tool } from "./subprocess.js";
// Algorithm 2 is requested explicitly whatever the tool default, and nothing
// else that shapes the fingerprint (sample-rate scaling, -length) is passed
// (§6.1.2). -json only selects the output format.
export const FPCALC_ARGS = ['-json', '-algorithm', '2'];
const rejection = ({ stderr, exit_code }) => {
    const message = stderr.trim() || `fpcalc exited ${exit_code}`;
    if (/empty fingerprint/i.test(message))
        return new IngestError('empty_fingerprint', message);
    if (/audio stream|invalid data/i.test(message))
        return new IngestError('no_audio', message);
    return new IngestError('tool_failed', message);
};
// Takes the original file. Callers must never pass the tag-stripped copy
// (§6.1.2.1): the fingerprint is computed before tag stripping runs. An empty
// fingerprint, an error exit, or no decodable audio rejects the ingest
// (§6.4.1 step 1), so sha256("") never becomes a track id.
export const compute_fingerprint = async ({ file_path, toolchain }) => {
    const { exit_code, stdout, stderr } = await run_tool({ command: toolchain.fpcalc_path, args: [...FPCALC_ARGS, file_path] });
    if (exit_code !== 0)
        throw rejection({ stderr, exit_code });
    let fingerprint;
    try {
        fingerprint = JSON.parse(stdout).fingerprint;
    }
    catch {
        throw new IngestError('tool_failed', `fpcalc printed no JSON for ${file_path}`);
    }
    if (typeof fingerprint !== 'string')
        throw new IngestError('tool_failed', `fpcalc printed no fingerprint for ${file_path}`);
    if (fingerprint.length === 0)
        throw new IngestError('empty_fingerprint', `fpcalc produced an empty fingerprint for ${file_path}`);
    return fingerprint;
};
