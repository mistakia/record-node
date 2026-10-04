// The tool host: tools run in it, counted output never crosses to the node,
// and a host that dies fails its running tools and is replaced.

import { describe, expect, test } from 'bun:test'

import { run_tool, run_tool_counting } from '#ingest/subprocess.ts'
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
