// Batch import with progress callbacks (the import:* events of 7-http-api.yaml).

import { randomUUID } from 'node:crypto'

import type {
  ImportEventHandler,
  ImportEventPayloads,
  ImportEventType,
  ImportSource,
  Importer,
  IngestedTrack
} from '#types/ingest.ts'

const error_summary = (error: unknown): { code: string, message: string } => {
  const code = (error as { code?: unknown } | null)?.code
  return {
    code: typeof code === 'string' ? code : 'internal',
    message: error instanceof Error ? error.message : String(error)
  }
}

// ingest_file is the bound single-file pipeline, for example ingest_local_file
// with the target library and toolchain applied. Files run one at a time, and
// each call gets the file's position in its batch.
export const create_importer = ({ ingest_file }: {
  ingest_file: (file_path: string, index: number) => Promise<IngestedTrack>
}): Importer => {
  const handlers = new Map<ImportEventType, Set<ImportEventHandler<never>>>()

  const emit = <T extends ImportEventType>(type: T, payload: ImportEventPayloads[T]) => {
    for (const handler of handlers.get(type) ?? []) {
      try {
        (handler as ImportEventHandler<T>)(payload)
      } catch (error) {
        process.emitWarning(`import event handler for ${type} threw: ${error_summary(error).message}`)
      }
    }
  }

  const run = async ({ import_id, file_paths, source }: {
    import_id: string
    file_paths: readonly string[]
    source: ImportSource
  }) => {
    const file_count = file_paths.length
    emit('import:starting', { import_id, source, file_count })
    let track_count = 0
    let error_count = 0
    for (const [index, file_path] of file_paths.entries()) {
      const completed = index + 1
      const remaining = file_count - completed
      try {
        const track = await ingest_file(file_path, index)
        track_count += 1
        emit('import:processed-file', { import_id, file_path, track, completed, remaining })
      } catch (error) {
        error_count += 1
        emit('import:error', { import_id, file_path, error: error_summary(error), completed, remaining })
      }
    }
    emit('import:finished', { import_id, track_count, error_count })
  }

  return {
    on: (type, handler) => {
      const set = handlers.get(type) ?? new Set()
      handlers.set(type, set.add(handler as ImportEventHandler<never>))
      return () => { set.delete(handler as ImportEventHandler<never>) }
    },
    import_files: ({ file_paths, source = 'file' }) => {
      const import_id = randomUUID()
      const batch = [...file_paths]
      // run never rejects: every failure becomes an import:error event.
      setTimeout(() => { run({ import_id, file_paths: batch, source }).catch(() => {}) }, 0)
      return { import_id, file_count: batch.length }
    }
  }
}
