// Node smoke for src/ingest: the F7 fixture through ingest_local_file and the
// importer, run with `node test/smoke/ingest-node.ts` (Node 22.18+ strips
// types). Proves the ingest path uses no Bun-only API. Honors
// RECORD_TOOLCHAIN_PREFLIGHT=bypass like the test helpers.

import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'

import { create_importer } from '#ingest/import.ts'
import { ingest_local_file } from '#ingest/pipeline-local.ts'
import { open_ingest_target, toolchain } from '#test/helpers/ingest.ts'

const FIXTURE = fileURLToPath(new URL('../fixtures/audio/chirp-10s.flac', import.meta.url))
const F7_TRACK_ID = '13f92b74d4d33accd2424b87914fbc6d087b7557fb2166330756bdcddcd8b6db'

const target = await open_ingest_target()
const importer = create_importer({ ingest_file: (file_path) => ingest_local_file({ file_path, target, toolchain }) })
const finished = new Promise((resolve) => importer.on('import:finished', resolve))
const processed: string[] = []
importer.on('import:processed-file', ({ track }) => processed.push(track.track_id))
const ack = importer.import_files({ file_paths: [FIXTURE] })

assert.deepEqual(await finished, { import_id: ack.import_id, track_count: 1, error_count: 0 })
assert.deepEqual(processed, [F7_TRACK_ID])
console.log(`node ${process.version}: ingest smoke passed (ffmpeg ${toolchain.ffmpeg_version}, fpcalc ${toolchain.fpcalc_version})`)
