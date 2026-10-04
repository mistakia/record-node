// Runs the protocol-bound external tools (fpcalc, ffmpeg) without a shell,
// through the tool host (tool-host.ts), so a spawn never forks the node.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IngestError } from '#types/ingest.ts';
// The source under Bun, the build under Node.
const HOST_PATH = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './tool-host.ts' : './tool-host.js', import.meta.url));
let host;
let next_id = 0;
// The host holds the process open only while a tool runs. Bun's IPC channel
// has no ref of its own.
const hold = (child, held) => {
    if (held) {
        child.ref();
        child.channel?.ref?.();
    }
    else {
        child.unref();
        child.channel?.unref?.();
    }
};
const start_host = () => {
    const child = fork(HOST_PATH, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    const pending = new Map();
    const started = { child, pending };
    const fail_all = (message) => {
        if (host === started)
            host = undefined;
        for (const { command, reject } of pending.values())
            reject(new IngestError('tool_failed', `${command}: ${message}`));
        pending.clear();
    };
    child.on('message', (response) => {
        const waiting = pending.get(response.id);
        if (waiting === undefined)
            return;
        pending.delete(response.id);
        if (pending.size === 0)
            hold(child, false);
        waiting.resolve(response);
    });
    child.on('error', (error) => { fail_all(`the tool host failed: ${error.message}`); });
    child.on('exit', (code, signal) => { fail_all(`the tool host exited (${signal ?? code})`); });
    return started;
};
const request = async ({ command, args, count_stdout }) => {
    host ??= start_host();
    const { child, pending } = host;
    const id = next_id++;
    const response = await new Promise((resolve, reject) => {
        pending.set(id, { command, resolve, reject });
        hold(child, true);
        child.send({ id, command, args: [...args], count_stdout });
    });
    if ('start_error' in response)
        throw new IngestError('toolchain_unavailable', `cannot run ${command}: ${response.start_error}`);
    return response;
};
// Resolves with the exit code on any exit, so callers decide what a non-zero
// exit means. Rejects only when the binary cannot be started.
export const run_tool = async ({ command, args }) => {
    const { exit_code, stdout, stderr } = await request({ command, args, count_stdout: false });
    return { exit_code, stdout, stderr };
};
// As run_tool, with the byte count of stdout in place of its text.
export const run_tool_counting = async ({ command, args }) => {
    const { exit_code, stdout_bytes = 0, stderr } = await request({ command, args, count_stdout: true });
    return { exit_code, stdout_bytes, stderr };
};
