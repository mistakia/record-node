// The import progress contract: ack first, then starting, one settle event
// per file, and finished.

import { describe, expect, test } from 'bun:test'

import { create_importer } from '#ingest/import.ts'
import { IngestError, type ImportEventPayloads, type IngestedTrack } from '#types/ingest.ts'

const track_for = (file_path: string): IngestedTrack =>
  ({ track_id: file_path, content_cid: `content-${file_path}`, entry_hash: `entry-${file_path}`, existing: false })

const fake_ingest = async (file_path: string) => {
  if (file_path.startsWith('bad')) throw new IngestError('no_audio', `${file_path} has no audio`)
  return track_for(file_path)
}

const record_events = (importer: ReturnType<typeof create_importer>) => {
  const events: Array<[string, unknown]> = []
  const finished = new Promise<ImportEventPayloads['import:finished']>((resolve) => {
    importer.on('import:finished', (payload) => {
      events.push(['import:finished', payload])
      resolve(payload)
    })
  })
  for (const type of ['import:starting', 'import:processed-file', 'import:error'] as const) {
    importer.on(type, (payload) => events.push([type, payload]))
  }
  return { events, finished }
}

describe('create_importer', () => {
  test('acks with an import_id and file_count, then emits each file in order', async () => {
    const importer = create_importer({ ingest_file: fake_ingest })
    const { events, finished } = record_events(importer)
    const ack = importer.import_files({ file_paths: ['a.flac', 'bad.flac', 'c.flac'] })
    expect(ack.import_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(ack.file_count).toBe(3)
    expect(events).toEqual([])
    expect(await finished).toEqual({ import_id: ack.import_id, track_count: 2, error_count: 1 })
    const { import_id } = ack
    expect(events).toEqual([
      ['import:starting', { import_id, source: 'file', file_count: 3 }],
      ['import:processed-file', { import_id, file_path: 'a.flac', track: track_for('a.flac'), completed: 1, remaining: 2 }],
      ['import:error', { import_id, file_path: 'bad.flac', error: { code: 'no_audio', message: 'bad.flac has no audio' }, completed: 2, remaining: 1 }],
      ['import:processed-file', { import_id, file_path: 'c.flac', track: track_for('c.flac'), completed: 3, remaining: 0 }],
      ['import:finished', { import_id, track_count: 2, error_count: 1 }]
    ])
  })

  test('an empty batch still starts and finishes; source passes through', async () => {
    const importer = create_importer({ ingest_file: fake_ingest })
    const { events, finished } = record_events(importer)
    const { import_id, file_count } = importer.import_files({ file_paths: [], source: 'url' })
    expect(file_count).toBe(0)
    await finished
    expect(events).toEqual([
      ['import:starting', { import_id, source: 'url', file_count: 0 }],
      ['import:finished', { import_id, track_count: 0, error_count: 0 }]
    ])
  })

  test('unsubscribe stops delivery, and a throwing handler does not stop the import', async () => {
    const importer = create_importer({ ingest_file: fake_ingest })
    const seen: string[] = []
    const off = importer.on('import:processed-file', ({ file_path }) => seen.push(file_path))
    importer.on('import:starting', () => { throw new Error('handler bug') })
    const { finished } = record_events(importer)
    off()
    importer.import_files({ file_paths: ['a.flac'] })
    expect(await finished).toMatchObject({ track_count: 1, error_count: 0 })
    expect(seen).toEqual([])
  })
})
