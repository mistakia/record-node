// Library types (§3.5.1, §4.8).

export type LibraryType = 'recordstore' | 'listens' | 'identity'

export const LIBRARY_TYPES: readonly LibraryType[] = ['recordstore', 'listens', 'identity']

// The narrow block access the core needs to create and resolve an AC chain.
// The ContentStore satisfies it.
export interface BlockStore {
  get: (cid: string) => Promise<Uint8Array | undefined>
  put: (cid: string, bytes: Uint8Array) => Promise<void>
}
