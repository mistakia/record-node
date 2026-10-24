// Library types (§3.5.1, §4.8, §4.9).

export type LibraryType = 'recordstore' | 'labels' | 'listens' | 'identity'

export const LIBRARY_TYPES: readonly LibraryType[] = ['recordstore', 'labels', 'listens', 'identity']

// The narrow block access the core needs to create and resolve an AC chain.
// The ContentStore satisfies it.
export interface BlockStore {
  get: (cid: string) => Promise<Uint8Array | undefined>
  put: (cid: string, bytes: Uint8Array) => Promise<void>
}
