// Runs the protocol-bound external tools (fpcalc, ffmpeg) without a shell,
// through the tool host (tool-host.ts), so a spawn never forks the node.
// Under Electron the node runs as a utility process, which cannot fork a Node
// child once the app turns its RunAsNode fuse off, so there the node runs the
// tools itself; the app's node is small, and macOS spawns without copying
// page tables.

import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { IngestError } from '#types/ingest.ts'
import { run_tool_request } from './tool-runner.ts'

export interface ToolOutput {
  readonly exit_code: number
  readonly stdout: string
  readonly stderr: string
}

export interface ToolRequest {
  readonly id: number
  readonly command: string
  readonly args: readonly string[]
  // Count stdout's bytes rather than return them.
  readonly count_stdout: boolean
}

type ToolResult = ToolOutput & { readonly stdout_bytes?: number }

export type ToolResponse =
  | { readonly id: number, readonly start_error: string }
  | ToolResult & { readonly id: number }

// The source under Bun, the build under Node.
const HOST_PATH = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './tool-host.ts' : './tool-host.js', import.meta.url))

interface Pending {
  readonly command: string
  readonly resolve: (response: ToolResponse) => void
  readonly reject: (error: Error) => void
}

let host: { child: ChildProcess, pending: Map<number, Pending> } | undefined
let next_id = 0

// The host holds the process open only while a tool runs. Bun's IPC channel
// has no ref of its own.
const hold = (child: ChildProcess, held: boolean) => {
  if (held) {
    child.ref()
    child.channel?.ref?.()
  } else {
    child.unref()
    child.channel?.unref?.()
  }
}

const start_host = () => {
  const child = fork(HOST_PATH, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] })
  const pending = new Map<number, Pending>()
  const started = { child, pending }
  const fail_all = (message: string) => {
    if (host === started) host = undefined
    for (const { command, reject } of pending.values()) reject(new IngestError('tool_failed', `${command}: ${message}`))
    pending.clear()
  }
  child.on('message', (response: ToolResponse) => {
    const waiting = pending.get(response.id)
    if (waiting === undefined) return
    pending.delete(response.id)
    if (pending.size === 0) hold(child, false)
    waiting.resolve(response)
  })
  child.on('error', (error) => { fail_all(`the tool host failed: ${error.message}`) })
  child.on('exit', (code, signal) => { fail_all(`the tool host exited (${signal ?? code})`) })
  return started
}

const via_host = async (tool_request: ToolRequest): Promise<ToolResponse> => {
  host ??= start_host()
  const { child, pending } = host
  return await new Promise<ToolResponse>((resolve, reject) => {
    pending.set(tool_request.id, { command: tool_request.command, resolve, reject })
    hold(child, true)
    child.send(tool_request)
  })
}

const in_process = async (tool_request: ToolRequest): Promise<ToolResponse> =>
  await new Promise<ToolResponse>((resolve) => { run_tool_request(tool_request, resolve) })

export const TOOLS_IN_PROCESS = process.versions.electron !== undefined

const request = async ({ command, args, count_stdout }: { command: string, args: readonly string[], count_stdout: boolean }): Promise<ToolResult> => {
  const tool_request: ToolRequest = { id: next_id++, command, args: [...args], count_stdout }
  const response = await (TOOLS_IN_PROCESS ? in_process : via_host)(tool_request)
  if ('start_error' in response) throw new IngestError('toolchain_unavailable', `cannot run ${command}: ${response.start_error}`)
  return response
}

// Resolves with the exit code on any exit, so callers decide what a non-zero
// exit means. Rejects only when the binary cannot be started.
export const run_tool = async ({ command, args }: { command: string, args: readonly string[] }): Promise<ToolOutput> => {
  const { exit_code, stdout, stderr } = await request({ command, args, count_stdout: false })
  return { exit_code, stdout, stderr }
}

// As run_tool, with the byte count of stdout in place of its text.
export const run_tool_counting = async ({ command, args }: { command: string, args: readonly string[] }): Promise<{ exit_code: number, stdout_bytes: number, stderr: string }> => {
  const { exit_code, stdout_bytes = 0, stderr } = await request({ command, args, count_stdout: true })
  return { exit_code, stdout_bytes, stderr }
}
