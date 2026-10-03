// Version pins for the protocol-bound tools (§6.1.5, §6.2.4). The F7 vectors
// were produced by exactly these versions, so a peer refuses to start ingest
// on any other.
import { IngestError } from '#types/ingest.ts';
import { run_tool } from "./subprocess.js";
export const PINNED_FFMPEG_VERSION = '7.1.1';
export const PINNED_FPCALC_VERSION = '1.5.1';
// A distro suffix on the pinned version (7.1.1-1ubuntu1) still matches.
const matches_pin = ({ found, pinned }) => found === pinned || found.startsWith(`${pinned}-`);
const read_version = async ({ command, pattern, tool }) => {
    const { exit_code, stdout } = await run_tool({ command, args: ['-version'] });
    const first_line = stdout.split('\n')[0] ?? '';
    const version = pattern.exec(first_line)?.[1];
    if (exit_code !== 0 || version === undefined) {
        throw new IngestError('toolchain_unavailable', `${tool} at ${command} did not report a version (exit ${exit_code}): ${first_line}`);
    }
    return version;
};
const pin_mismatches = ({ ffmpeg_version, fpcalc_version }) => [
    ['ffmpeg', ffmpeg_version, PINNED_FFMPEG_VERSION],
    ['fpcalc', fpcalc_version, PINNED_FPCALC_VERSION]
].filter(([, found, pinned]) => !matches_pin({ found: found, pinned: pinned }))
    .map(([tool, found, pinned]) => `${tool} ${found} (pinned ${pinned})`);
export const is_pinned_toolchain = (toolchain) => pin_mismatches(toolchain).length === 0;
// Refuses a version other than the pin unless allow_version_mismatch is set,
// which exists for local development on an unpinned machine only.
export const verify_toolchain = async ({ ffmpeg_path = 'ffmpeg', fpcalc_path = 'fpcalc', allow_version_mismatch = false } = {}) => {
    const ffmpeg_version = await read_version({ command: ffmpeg_path, pattern: /^ffmpeg version (\S+)/, tool: 'ffmpeg' });
    const fpcalc_version = await read_version({ command: fpcalc_path, pattern: /^fpcalc version (\S+)/i, tool: 'fpcalc' });
    const mismatches = pin_mismatches({ ffmpeg_version, fpcalc_version });
    if (mismatches.length > 0 && !allow_version_mismatch) {
        throw new IngestError('toolchain_mismatch', `ingest refuses an unpinned toolchain: ${mismatches.join(', ')}`);
    }
    return { ffmpeg_path, fpcalc_path, ffmpeg_version, fpcalc_version };
};
