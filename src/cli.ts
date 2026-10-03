#!/usr/bin/env node
// Headless entry point: record-node [--port <n>] [--data-dir <dir>] [--config <file>]
// Starts the peer and the API server, and stops both on SIGTERM or SIGINT.

import { parseArgs } from 'node:util'

import { create_api_server, stop_api_server } from '#api/index.ts'
import { create_peer, start_peer, stop_peer } from '#peer/peer.ts'
import { as_api_resolver } from '#peer/resolver.ts'
import { load_config } from './config.ts'

const USAGE = 'usage: record-node [--port <n>] [--data-dir <dir>] [--config <file>]'

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    strict: true
  })
  if (values.help === true) {
    console.log(USAGE)
    return
  }
  const config = await load_config({ config_path: values.config, port: values.port, data_dir: values['data-dir'] })
  const peer = await create_peer({ config: config.peer })
  await start_peer(peer)
  peer.context.toolchain?.catch((error: Error) => { console.warn(`ingest disabled: ${error.message}`) })
  const server = await create_api_server({ peer, resolve: as_api_resolver(peer.context.resolve), port: config.port, host: config.host, cors_origins: config.cors_origins })
  console.log(`record-node listening on http://${config.host}:${server.port}/api (data ${config.peer.data_dir ?? 'in memory'})`)

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`${signal}: stopping`)
    stop_api_server(server)
      .then(async () => { await stop_peer(peer) })
      .then(() => { process.exit(0) }, (error: unknown) => {
        console.error(error)
        process.exit(1)
      })
  }
  process.on('SIGTERM', () => { shutdown('SIGTERM') })
  process.on('SIGINT', () => { shutdown('SIGINT') })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  console.error(USAGE)
  process.exit(1)
})
