// The tool host: a small process the node forks once, which runs fpcalc and
// ffmpeg on its behalf (subprocess.ts). On Linux a spawn forks the spawning
// process and copies its page tables, which blocks the caller's event loop
// for about 23 ms at the 800 MiB a large library's node holds; from here,
// a few tens of MiB, it costs under one. It exits with its node.
import { execFile, spawn } from 'node:child_process';
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;
const reply = (response) => { process.send?.(response); };
const run = ({ id, command, args }) => {
    execFile(command, args, { maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error !== null && typeof error.code === 'string') {
            reply({ id, start_error: error.message });
            return;
        }
        const exit_code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        reply({ id, exit_code, stdout, stderr });
    });
};
// Counts stdout instead of keeping it, so a decode's PCM never crosses to the node.
const count = ({ id, command, args }) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout_bytes = 0;
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout_bytes += chunk.length; });
    child.stderr.on('data', (chunk) => { if (stderr.length < STDERR_LIMIT_BYTES)
        stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { reply({ id, start_error: error.message }); });
    child.on('close', (code) => { reply({ id, exit_code: code ?? 1, stdout: '', stdout_bytes, stderr }); });
};
process.on('message', (request) => { (request.count_stdout ? count : run)(request); });
process.on('disconnect', () => { process.exit(0); });
