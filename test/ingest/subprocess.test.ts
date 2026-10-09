// The tool host: tools run in it, counted output never crosses to the node,
// and a host that dies fails its running tools and is replaced.

import { describe, expect, test } from 'bun:test'

import { run_tool, run_tool_counting, TOOLS_IN_PROCESS, type ToolResponse } from '#ingest/subprocess.ts'
import { run_tool_request } from '#ingest/tool-runner.ts'
import { toolchain } from '#test/helpers/ingest.ts'

describe('tool host', () => {
  test('counts stdout bytes instead of returning them', async () => {
    // Two seconds of 44.1 kHz mono 16-bit PCM.
    const args = ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'sine=duration=2', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']
    expect(await run_tool_counting({ command: toolchain.ffmpeg_path, args })).toMatchObject({ exit_code: 0, stdout_bytes: 176_400 })
  })

  test('a binary that cannot start rejects as toolchain_unavailable', async () => {
    await expect(run_tool({ command: '/nonexistent/record-tool', args: [] })).rejects.toMatchObject({ code: 'toolchain_unavailable' })
  })

  test('a host that dies fails its running tools, and the next tool starts a new one', async () => {
    await expect(run_tool({ command: 'sh', args: ['-c', 'kill -9 $PPID; sleep 5'] })).rejects.toMatchObject({ code: 'tool_failed' })
    expect(await run_tool({ command: 'sh', args: ['-c', 'echo alive'] })).toMatchObject({ exit_code: 0, stdout: 'alive\n' })
  })
})

// What the node runs itself under Electron, where it cannot fork the host.
describe('tool runner', () => {
  const answer = async (request: Parameters<typeof run_tool_request>[0]) =>
    await new Promise<ToolResponse>((resolve) => { run_tool_request(request, resolve) })

  test('runs a tool and answers with its output, or counts it', async () => {
    expect(await answer({ id: 1, command: 'sh', args: ['-c', 'echo ran; exit 3'], count_stdout: false })).toEqual({ id: 1, exit_code: 3, stdout: 'ran\n', stderr: '' })
    expect(await answer({ id: 2, command: 'sh', args: ['-c', 'printf 12345'], count_stdout: true })).toMatchObject({ id: 2, exit_code: 0, stdout: '', stdout_bytes: 5 })
  })

  test('answers a binary that cannot start with its start error', async () => {
    expect(await answer({ id: 3, command: '/nonexistent/record-tool', args: [], count_stdout: false })).toMatchObject({ id: 3, start_error: expect.any(String) })
  })

  test('the node forks the host everywhere but Electron', () => {
    expect(TOOLS_IN_PROCESS).toBe(false)
  })
})
