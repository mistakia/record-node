// Library types (§3.5.1).

export type LibraryType = 'recordstore' | 'listens'

export const LIBRARY_TYPES: readonly LibraryType[] = ['recordstore', 'listens']

// The narrow block access the core needs to create and resolve an AC chain.
// The single-peer stage's ContentStore satisfies it.
export interface BlockStore {
  get: (cid: string) => Promise<Uint8Array | undefined>
  put: (cid: string, bytes: Uint8Array) => Promise<void>
}
