#!/usr/bin/env node
// Headless entry point: record-node [--port <n>] [--data-dir <dir>] [--config <file>]
// Starts the peer and the API server, plus the token-gated remote listener
// when the config names one, and stops them on SIGTERM or SIGINT.
// `record-node token issue|list|revoke` manages the access tokens (§8.7.3)
// of the remote listener and of the managed label libraries, without
// starting the peer.
import { parseArgs } from 'node:util';
import { create_token_authenticator, issue_access_token, list_access_tokens, revoke_access_token } from '#api/access-tokens.ts';
import { create_api_server, stop_api_server } from '#api/index.ts';
import { parse_library_address } from '#encoding/library-address.ts';
import { data_paths } from '#peer/config.ts';
import { create_peer, start_peer, stop_peer } from '#peer/peer.ts';
import { DataDirectoryLocked } from '#peer/lock.ts';
import { as_api_resolver } from '#peer/resolver.ts';
import { load_config } from "./config.js";
const USAGE = [
    'usage: record-node [--port <n>] [--data-dir <dir>] [--config <file>]',
    '       record-node token issue --label <label> [--manages <library address>] [--data-dir <dir>] [--config <file>]',
    '       record-node token list [--data-dir <dir>] [--config <file>]',
    '       record-node token revoke <id> [--data-dir <dir>] [--config <file>]'
].join('\n');
// The token is the only line on stdout, so a wrapper can render it (as a QR
// code on canonical) without parsing; everything else goes to stderr. With
// --manages, stderr also gives the managed_label_libraries entry that makes
// the token the only writer of that library's labels.
const run_token_command = async ({ path, args, label, manages }) => {
    const [command, ...rest] = args;
    if (command !== 'issue' && (label !== undefined || manages !== undefined))
        throw new Error('--label and --manages apply to token issue only');
    if (command === 'issue') {
        if (rest.length > 0 || label === undefined || label === '')
            throw new Error('token issue takes --label <label> and no other argument');
        if (manages !== undefined)
            parse_library_address(manages);
        const { token, entry } = await issue_access_token({ path, label });
        console.error(`issued ${entry.id} (${entry.label}); the token is shown once`);
        if (manages !== undefined)
            console.error(`add to the node config: "managed_label_libraries": ${JSON.stringify({ [manages]: entry.id })}`);
        console.log(token);
    }
    else if (command === 'list' && rest.length === 0) {
        for (const { id, label, created_at, revoked_at } of await list_access_tokens(path)) {
            console.log([id, revoked_at === null ? 'active' : `revoked ${revoked_at}`, created_at, label].join('\t'));
        }
    }
    else if (command === 'revoke' && rest.length === 1) {
        const { id, revoked_at } = await revoke_access_token({ path, id: rest[0] });
        console.error(`revoked ${id} at ${String(revoked_at)}`);
    }
    else {
        throw new Error(`unknown token command: ${args.join(' ')}`);
    }
};
const main = async () => {
    const { values, positionals } = parseArgs({
        options: {
            port: { type: 'string' },
            'data-dir': { type: 'string' },
            config: { type: 'string' },
            label: { type: 'string' },
            manages: { type: 'string' },
            help: { type: 'boolean', short: 'h' }
        },
        allowPositionals: true,
        strict: true
    });
    if (values.help === true) {
        console.log(USAGE);
        return;
    }
    const config = await load_config({ config_path: values.config, port: values.port, data_dir: values['data-dir'] });
    const tokens_path = data_paths(config.peer.data_dir).access_tokens;
    if (positionals.length > 0) {
        if (positionals[0] !== 'token')
            throw new Error(`unknown command: ${positionals[0]}`);
        await run_token_command({ path: tokens_path, args: positionals.slice(1), label: values.label, manages: values.manages });
        return;
    }
    if (values.label !== undefined || values.manages !== undefined)
        throw new Error('--label and --manages apply to token issue only');
    const started = performance.now();
    const peer = await create_peer({ config: config.peer });
    const created = performance.now();
    await start_peer(peer);
    peer.context.toolchain?.catch((error) => { console.warn(`ingest disabled: ${error.message}`); });
    // Both listeners know a presented token, so a managed label library's
    // token writes it on either; the loopback one requires none.
    const tokens = create_token_authenticator({ path: tokens_path });
    const managed_label_libraries = config.managed_label_libraries;
    const server = await create_api_server({
        peer, resolve: as_api_resolver(peer.context.resolve), port: config.port, host: config.host, cors_origins: config.cors_origins, identify: tokens.identify, managed_label_libraries
    });
    const seconds = (ms) => (ms / 1000).toFixed(1);
    const index = config.peer.index_dir === undefined ? '' : `, index ${config.peer.index_dir}`;
    console.log(`record-node listening on http://${config.host}:${server.port}/api (data ${config.peer.data_dir ?? 'in memory'}${index}) after ${seconds(performance.now() - started)} s (create ${seconds(created - started)} s)`);
    // The remote listener always takes a token, so it is safe behind a reverse
    // proxy; the loopback listener above takes one only optionally, so local
    // callers without one keep their rights. A bind failure here leaves the
    // loopback API serving.
    let remote;
    let unwatch = () => { };
    if (config.remote_listener !== undefined) {
        const { host, port } = config.remote_listener;
        try {
            const started_remote = await create_api_server({
                peer, resolve: as_api_resolver(peer.context.resolve), port, host, cors_origins: config.cors_origins, authenticate: tokens.authenticate, identify: tokens.identify, managed_label_libraries, docs: false
            });
            remote = started_remote;
            unwatch = tokens.watch(() => { started_remote.bridge.revalidate().catch(() => { }); });
            console.log(`record-node remote listener on http://${host}:${started_remote.port}/api (bearer token required, tokens ${tokens_path})`);
        }
        catch (error) {
            console.error(`remote listener on ${host}:${port} failed to start: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    let stopping = false;
    const shutdown = (signal) => {
        if (stopping)
            return;
        stopping = true;
        console.log(`${signal}: stopping`);
        unwatch();
        Promise.all([stop_api_server(server), remote === undefined ? undefined : stop_api_server(remote)])
            .then(async () => { await stop_peer(peer); })
            .then(() => { process.exit(0); }, (error) => {
            console.error(error);
            process.exit(1);
        });
    };
    process.on('SIGTERM', () => { shutdown('SIGTERM'); });
    process.on('SIGINT', () => { shutdown('SIGINT'); });
};
// A held data directory exits with its own status (§8.4.6), so a host that
// spawned the node can tell it from any other start failure.
export const EXIT_DATA_DIR_LOCKED = 75;
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof DataDirectoryLocked)
        process.exit(EXIT_DATA_DIR_LOCKED);
    console.error(USAGE);
    process.exit(1);
});
