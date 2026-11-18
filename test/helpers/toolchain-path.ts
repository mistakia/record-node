// Test preload: puts the pinned toolchain cli/fetch-toolchain.sh installed
// first on PATH, so the suite finds it with no shell setup. It never fetches;
// when nothing is installed, PATH is left as it was and the preflight decides.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const script = join(import.meta.dir, '../../cli/fetch-toolchain.sh')
const bin_dir = spawnSync('sh', [script, '--print-bin-dir'], { encoding: 'utf8' }).stdout.trim()

if (bin_dir !== '' && existsSync(join(bin_dir, 'ffmpeg')) && existsSync(join(bin_dir, 'fpcalc'))) {
  process.env.PATH = `${bin_dir}${delimiter}${process.env.PATH ?? ''}`
} else if (process.env.RECORD_TOOLCHAIN_PREFLIGHT !== 'bypass') {
  console.warn(`no pinned toolchain at ${bin_dir}; run cli/fetch-toolchain.sh (linux x86_64)`)
}
