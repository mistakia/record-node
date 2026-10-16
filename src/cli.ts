#!/usr/bin/env node
// Headless entry point: record-node [--port <n>] [--data-dir <dir>] [--config <file>]
// Starts the peer and the API server, plus the token-gated remote listener
// when the config names one, and stops them on SIGTERM or SIGINT.
// `record-node token issue|list|revoke` manages the remote listener's access
// tokens (§8.7.3) without starting the peer.

import { parseArgs } from 'node:util'

import { create_token_authenticator, issue_access_token, list_access_tokens, revoke_access_token } from '#api/access-tokens.ts'
import { create_api_server, stop_api_server, type ApiServer } from '#api/index.ts'
import { data_paths } from '#peer/config.ts'
import { create_peer, start_peer, stop_peer } from '#peer/peer.ts'
import { DataDirectoryLocked } from '#peer/lock.ts'
import { as_api_resolver } from '#peer/resolver.ts'
import { load_config } from './config.ts'

const USAGE = [
  'usage: record-node [--port <n>] [--data-dir <dir>] [--config <file>]',
  '       record-node token issue --label <label> [--data-dir <dir>] [--config <file>]',
  '       record-node token list [--data-dir <dir>] [--config <file>]',
  '       record-node token revoke <id> [--data-dir <dir>] [--config <file>]'
].join('\n')

// The token is the only line on stdout, so a wrapper can render it (as a QR
// code on canonical) without parsing; everything else goes to stderr.
const run_token_command = async ({ path, args, label }: { path: string, args: string[], label: string | undefined }): Promise<void> => {
  const [command, ...rest] = args
  if (command !== 'issue' && label !== undefined) throw new Error('--label applies to token issue only')
  if (command === 'issue') {
    if (rest.length > 0 || label === undefined || label === '') throw new Error('token issue takes --label <label> and no other argument')
    const { token, entry } = await issue_access_token({ path, label })
    console.error(`issued ${entry.id} (${entry.label}); the token is shown once`)
    console.log(token)
  } else if (command === 'list' && rest.length === 0) {
    for (const { id, label, created_at, revoked_at } of await list_access_tokens(path)) {
      console.log([id, revoked_at === null ? 'active' : `revoked ${revoked_at}`, created_at, label].join('\t'))
    }
  } else if (command === 'revoke' && rest.length === 1) {
    const { id, revoked_at } = await revoke_access_token({ path, id: rest[0] as string })
    console.error(`revoked ${id} at ${String(revoked_at)}`)
  } else {
    throw new Error(`unknown token command: ${args.join(' ')}`)
  }
}

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      config: { type: 'string' },
      label: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true,
    strict: true
  })
  if (values.help === true) {
    console.log(USAGE)
    return
  }
  const config = await load_config({ config_path: values.config, port: values.port, data_dir: values['data-dir'] })
  const tokens_path = data_paths(config.peer.data_dir as string).access_tokens
  if (positionals.length > 0) {
    if (positionals[0] !== 'token') throw new Error(`unknown command: ${positionals[0]}`)
    await run_token_command({ path: tokens_path, args: positionals.slice(1), label: values.label })
    return
  }
  if (values.label !== undefined) throw new Error('--label applies to token issue only')
  const started = performance.now()
  const peer = await create_peer({ config: config.peer })
  const created = performance.now()
  await start_peer(peer)
  peer.context.toolchain?.catch((error: Error) => { console.warn(`ingest disabled: ${error.message}`) })
  const server = await create_api_server({ peer, resolve: as_api_resolver(peer.context.resolve), port: config.port, host: config.host, cors_origins: config.cors_origins })
  const seconds = (ms: number): string => (ms / 1000).toFixed(1)
  const index = config.peer.index_dir === undefined ? '' : `, index ${config.peer.index_dir}`
  console.log(`record-node listening on http://${config.host}:${server.port}/api (data ${config.peer.data_dir ?? 'in memory'}${index}) after ${seconds(performance.now() - started)} s (create ${seconds(created - started)} s)`)

  // The remote listener always takes a token, so it is safe behind a reverse
  // proxy; the loopback listener above stays tokenless for local callers.
  // A bind failure here leaves the loopback API serving.
  let remote: ApiServer | undefined
  let unwatch = (): void => {}
  if (config.remote_listener !== undefined) {
    const { host, port } = config.remote_listener
    const tokens = create_token_authenticator({ path: tokens_path })
    try {
      const started_remote = await create_api_server({ peer, resolve: as_api_resolver(peer.context.resolve), port, host, cors_origins: config.cors_origins, authenticate: tokens.authenticate, docs: false })
      remote = started_remote
      unwatch = tokens.watch(() => { started_remote.bridge.revalidate().catch(() => {}) })
      console.log(`record-node remote listener on http://${host}:${started_remote.port}/api (bearer token required, tokens ${tokens_path})`)
    } catch (error) {
      console.error(`remote listener on ${host}:${port} failed to start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`${signal}: stopping`)
    unwatch()
    Promise.all([stop_api_server(server), remote === undefined ? undefined : stop_api_server(remote)])
      .then(async () => { await stop_peer(peer) })
      .then(() => { process.exit(0) }, (error: unknown) => {
        console.error(error)
        process.exit(1)
      })
  }
  process.on('SIGTERM', () => { shutdown('SIGTERM') })
  process.on('SIGINT', () => { shutdown('SIGINT') })
}

// A held data directory exits with its own status (§8.4.6), so a host that
// spawned the node can tell it from any other start failure.
export const EXIT_DATA_DIR_LOCKED = 75

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  if (error instanceof DataDirectoryLocked) process.exit(EXIT_DATA_DIR_LOCKED)
  console.error(USAGE)
  process.exit(1)
})
