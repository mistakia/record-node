// Version pins for the protocol-bound tools (§6.1.5, §6.2.4). The F7 vectors
// were produced by exactly these versions, so a peer refuses to start ingest
// on any other.

import { IngestError } from '#types/ingest.ts'
import { run_tool } from './subprocess.ts'

export const PINNED_FFMPEG_VERSION = '7.1.1'
export const PINNED_FPCALC_VERSION = '1.5.1'

declare const verified_toolchain_brand: unique symbol

// Only verify_toolchain produces one, so no ingest runs on unchecked tools.
// The binary paths are the only configurable part (§6.1.2).
export type Toolchain = {
  readonly ffmpeg_path: string
  readonly fpcalc_path: string
  readonly ffmpeg_version: string
  readonly fpcalc_version: string
  readonly [verified_toolchain_brand]: true
}

// A distro suffix on the pinned version (7.1.1-1ubuntu1) still matches.
const matches_pin = ({ found, pinned }: { found: string, pinned: string }): boolean =>
  found === pinned || found.startsWith(`${pinned}-`)

const read_version = async ({ command, pattern, tool }: {
  command: string
  pattern: RegExp
  tool: string
}): Promise<string> => {
  const { exit_code, stdout } = await run_tool({ command, args: ['-version'] })
  const first_line = stdout.split('\n')[0] ?? ''
  const version = pattern.exec(first_line)?.[1]
  if (exit_code !== 0 || version === undefined) {
    throw new IngestError('toolchain_unavailable', `${tool} at ${command} did not report a version (exit ${exit_code}): ${first_line}`)
  }
  return version
}

const pin_mismatches = ({ ffmpeg_version, fpcalc_version }: { ffmpeg_version: string, fpcalc_version: string }): string[] => [
  ['ffmpeg', ffmpeg_version, PINNED_FFMPEG_VERSION],
  ['fpcalc', fpcalc_version, PINNED_FPCALC_VERSION]
].filter(([, found, pinned]) => !matches_pin({ found: found as string, pinned: pinned as string }))
  .map(([tool, found, pinned]) => `${tool} ${found} (pinned ${pinned})`)

export const is_pinned_toolchain = (toolchain: Toolchain): boolean => pin_mismatches(toolchain).length === 0

// Refuses a version other than the pin unless allow_version_mismatch is set,
// which exists for local development on an unpinned machine only.
export const verify_toolchain = async ({
  ffmpeg_path = 'ffmpeg',
  fpcalc_path = 'fpcalc',
  allow_version_mismatch = false
}: {
  ffmpeg_path?: string
  fpcalc_path?: string
  allow_version_mismatch?: boolean
} = {}): Promise<Toolchain> => {
  const ffmpeg_version = await read_version({ command: ffmpeg_path, pattern: /^ffmpeg version (\S+)/, tool: 'ffmpeg' })
  const fpcalc_version = await read_version({ command: fpcalc_path, pattern: /^fpcalc version (\S+)/i, tool: 'fpcalc' })
  const mismatches = pin_mismatches({ ffmpeg_version, fpcalc_version })
  if (mismatches.length > 0 && !allow_version_mismatch) {
    throw new IngestError('toolchain_mismatch', `ingest refuses an unpinned toolchain: ${mismatches.join(', ')}`)
  }
  return { ffmpeg_path, fpcalc_path, ffmpeg_version, fpcalc_version } as Toolchain
}
