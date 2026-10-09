// Runs one fpcalc or ffmpeg request and answers it: the work the tool host
// does for the node, and the node does itself where it cannot fork one.

import { execFile, spawn } from 'node:child_process'

import type { ToolRequest, ToolResponse } from './subprocess.ts'

const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const STDERR_LIMIT_BYTES = 64 * 1024

const run = ({ id, command, args }: ToolRequest, reply: (response: ToolResponse) => void) => {
  execFile(command, args, { maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error !== null && typeof error.code === 'string') {
      reply({ id, start_error: error.message })
      return
    }
    const exit_code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
    reply({ id, exit_code, stdout, stderr })
  })
}

// Counts stdout instead of keeping it, so a decode's PCM is never held.
const count = ({ id, command, args }: ToolRequest, reply: (response: ToolResponse) => void) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout_bytes = 0
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout_bytes += chunk.length })
  child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < STDERR_LIMIT_BYTES) stderr += chunk.toString('utf8') })
  child.on('error', (error) => { reply({ id, start_error: error.message }) })
  child.on('close', (code) => { reply({ id, exit_code: code ?? 1, stdout: '', stdout_bytes, stderr }) })
}

export const run_tool_request = (request: ToolRequest, reply: (response: ToolResponse) => void): void => {
  (request.count_stdout ? count : run)(request, reply)
}
