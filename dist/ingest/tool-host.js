// The tool host: a small process the node forks once, which runs fpcalc and
// ffmpeg on its behalf (subprocess.ts). On Linux a spawn forks the spawning
// process and copies its page tables, which blocks the caller's event loop
// for about 23 ms at the 800 MiB a large library's node holds; from here,
// a few tens of MiB, it costs under one. It exits with its node.
import { run_tool_request } from "./tool-runner.js";
process.on('message', (request) => {
    run_tool_request(request, (response) => { process.send?.(response); });
});
process.on('disconnect', () => { process.exit(0); });
