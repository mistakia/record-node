// The heads of every library the peer holds, persisted so a restart can walk
// each oplog back out of the content store. Heads are the only library state
// kept outside the store: entries, content, and the AC chain are all blocks.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface HeadsStore {
  load: () => Promise<ReadonlyMap<string, readonly string[]>>
  // undefined forgets the library.
  save: (input: { library_address: string, heads: readonly string[] | undefined }) => Promise<void>
}

export const create_memory_heads_store = (): HeadsStore => {
  const heads = new Map<string, readonly string[]>()
  return {
    load: async () => new Map(heads),
    save: async ({ library_address, heads: next }) => {
      if (next === undefined) heads.delete(library_address)
      else heads.set(library_address, [...next])
    }
  }
}

// One JSON file of { [library_address]: heads }. Writes are serialised and
// land by rename, so the file is always a complete earlier or later state.
export const create_file_heads_store = ({ path }: { path: string }): HeadsStore => {
  let heads: Map<string, readonly string[]> | undefined
  let tail: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<Map<string, readonly string[]>> => {
    if (heads !== undefined) return heads
    try {
      heads = new Map(Object.entries(JSON.parse(await readFile(path, 'utf8')) as Record<string, string[]>))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      heads = new Map()
    }
    return heads
  }

  const write = async (state: Map<string, readonly string[]>) => {
    await mkdir(dirname(path), { recursive: true })
    const temp_path = `${path}.tmp`
    await writeFile(temp_path, `${JSON.stringify(Object.fromEntries(state), null, 2)}\n`)
    await rename(temp_path, path)
  }

  return {
    load: async () => new Map(await read()),
    save: async ({ library_address, heads: next }) => {
      const run = tail.then(async () => {
        const state = await read()
        if (next === undefined) state.delete(library_address)
        else state.set(library_address, [...next].sort())
        await write(state)
      })
      tail = run.catch(() => {})
      await run
    }
  }
}
