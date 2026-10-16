// The process entry point (dist/cli.js) under Node: the token subcommands and
// the token-gated remote listener beside the tokenless loopback one.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const CLI = join(import.meta.dir, '..', 'dist', 'cli.js')
const TOKEN_CHARS = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,2048}$/

const node_config = (remote_port: number): string => {
  const dir = mkdtempSync(join(tmpdir(), 'record-cli-'))
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify({ port: 0, data_dir: join(dir, 'data'), network: false, allow_toolchain_mismatch: true, remote_listener: { host: '127.0.0.1', port: remote_port } }))
  return path
}

const token = (config: string, ...args: string[]): { status: number | null, stdout: string, stderr: string } => {
  const { status, stdout, stderr } = spawnSync('node', [CLI, 'token', ...args, '--config', config], { encoding: 'utf8' })
  return { status, stdout, stderr }
}

interface RunningNode {
  child: ChildProcess
  output: () => string
  loopback: string
  remote: string | undefined
}

// Resolves once the node logs its loopback listener and the outcome of its
// remote one.
const start_node = async (config: string): Promise<RunningNode> => {
  const child = spawn('node', [CLI, '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const ready = new Promise<void>((resolve, reject) => {
    const check = () => {
      const loopback_up = /listening on http:\/\/127\.0\.0\.1:\d+\/api/.test(output)
      const remote_settled = /remote listener (on http|on 127\.0\.0\.1:\d+ failed)/.test(output)
      if (loopback_up && remote_settled) resolve()
    }
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); check() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); check() })
    child.once('exit', (code) => { reject(new Error(`node exited ${String(code)}: ${output}`)) })
  })
  await ready
  const loopback = /listening on (http:\/\/127\.0\.0\.1:\d+\/api)/.exec(output)?.[1] as string
  const remote = /remote listener on (http:\/\/127\.0\.0\.1:\d+\/api)/.exec(output)?.[1]
  return { child, output: () => output, loopback, remote }
}

const stop_node = async ({ child }: RunningNode): Promise<void> => {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await exited
}

const upgrade_status = async (socket: WebSocket): Promise<unknown> => await new Promise((resolve) => {
  socket.once('unexpected-response', (_req, res) => { resolve(res.statusCode) }).once('error', () => { resolve('error') })
})

describe('cli: token subcommands and the remote listener', () => {
  let config: string
  let node: RunningNode
  let issued: string
  let issued_id: string

  beforeAll(async () => {
    config = node_config(0)
    const result = token(config, 'issue', '--label', 'phone')
    expect(result.status).toBe(0)
    issued = result.stdout.trim()
    issued_id = /issued ([0-9a-f]+)/.exec(result.stderr)?.[1] as string
    node = await start_node(config)
  })

  afterAll(async () => { await stop_node(node) })

  test('token issue prints one token in the RFC 7230 token charset, and token list shows it without the secret', () => {
    expect(issued.split('\n')).toHaveLength(1)
    expect(issued).toMatch(TOKEN_CHARS)
    const listed = token(config, 'list')
    expect(listed.status).toBe(0)
    expect(listed.stdout).toContain(`${issued_id}\tactive`)
    expect(listed.stdout).not.toContain(issued)
    expect(token(config, 'issue').status).not.toBe(0)
    expect(token(config, 'revoke', 'missing').status).not.toBe(0)
  })

  test('the remote listener requires a token, the loopback listener does not, and /api/docs is loopback-only', async () => {
    expect(node.remote).toBeDefined()
    const remote = node.remote as string
    expect((await fetch(`${remote}/settings`)).status).toBe(401)
    expect((await fetch(`${remote}/settings`, { headers: { authorization: `Bearer ${issued}` } })).status).toBe(200)
    expect((await fetch(`${node.loopback}/settings`)).status).toBe(200)
    expect((await fetch(`${remote}/docs/`, { headers: { authorization: `Bearer ${issued}` } })).status).toBe(404)
    expect((await fetch(`${node.loopback}/docs/`)).status).toBe(200)
  })

  test('revoking a token closes its open event stream and refuses it on REST, without a restart', async () => {
    const ws_url = `${(node.remote as string).replace('http', 'ws')}/ws`
    expect(await upgrade_status(new WebSocket(ws_url, ['record']))).toBe(401)
    const second = token(config, 'issue', '--label', 'tablet')
    const second_id = /issued ([0-9a-f]+)/.exec(second.stderr)?.[1] as string
    const socket = new WebSocket(ws_url, ['record', `bearer.${second.stdout.trim()}`])
    await new Promise((resolve, reject) => { socket.once('open', resolve).once('error', reject) })
    expect(socket.protocol).toBe('record')
    const closed = new Promise<number>((resolve) => { socket.once('close', (code) => { resolve(code) }) })
    expect(token(config, 'revoke', second_id).status).toBe(0)
    expect(await closed).toBe(1008)
    expect((await fetch(`${node.remote as string}/settings`, { headers: { authorization: `Bearer ${second.stdout.trim()}` } })).status).toBe(401)
    expect((await fetch(`${node.remote as string}/settings`, { headers: { authorization: `Bearer ${issued}` } })).status).toBe(200)
  })
})

describe('cli: a remote listener that cannot bind', () => {
  test('leaves the loopback API answering', async () => {
    const blocker: Server = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const taken = (blocker.address() as { port: number }).port
    const node = await start_node(node_config(taken))
    try {
      expect(node.remote).toBeUndefined()
      expect(node.output()).toContain(`remote listener on 127.0.0.1:${taken} failed to start`)
      expect((await fetch(`${node.loopback}/settings`)).status).toBe(200)
    } finally {
      await stop_node(node)
      blocker.close()
    }
  })
})
