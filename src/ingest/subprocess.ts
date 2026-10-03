// Runs the protocol-bound external tools (fpcalc, ffmpeg) without a shell.

import { execFile } from 'node:child_process'

import { IngestError } from '#types/ingest.ts'

export interface ToolOutput {
  readonly exit_code: number
  readonly stdout: string
  readonly stderr: string
}

const MAX_BUFFER_BYTES = 16 * 1024 * 1024

// Resolves with the exit code on any exit, so callers decide what a non-zero
// exit means. Rejects only when the binary cannot be started.
export const run_tool = ({ command, args }: { command: string, args: readonly string[] }): Promise<ToolOutput> =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null && typeof error.code === 'string') {
        reject(new IngestError('toolchain_unavailable', `cannot run ${command}: ${error.message}`))
        return
      }
      const exit_code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ exit_code, stdout, stderr })
    })
  })
