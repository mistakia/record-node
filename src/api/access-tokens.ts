// The access-token store behind the remote listener (§8.7.3): a JSON array
// at <data_dir>/access-tokens.json holding each token's SHA-256, never the
// token itself. Tokens are issued, listed and revoked out of band by the
// `record-node token` subcommands; the node re-reads the file when it
// changes, so neither takes a restart.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { ApiError, type Authenticate } from './middleware.ts'

export interface AccessToken {
  readonly id: string
  readonly label: string
  readonly token_sha256: string
  readonly created_at: string
  // Null while the token is active.
  readonly revoked_at: string | null
}

export type AccessTokenSummary = Omit<AccessToken, 'token_sha256'>

const token_sha256 = (token: string): string => createHash('sha256').update(token).digest('hex')

const is_entry = (value: unknown): value is AccessToken => {
  if (value === null || typeof value !== 'object') return false
  const { id, label, token_sha256, created_at, revoked_at } = value as Record<string, unknown>
  return typeof id === 'string' && typeof label === 'string' && typeof token_sha256 === 'string' && /^[0-9a-f]{64}$/.test(token_sha256) &&
    typeof created_at === 'string' && (revoked_at === null || typeof revoked_at === 'string')
}

// A missing store is an empty one: no token has been issued yet.
export const read_access_tokens = async (path: string): Promise<AccessToken[]> => {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value) || !value.every(is_entry)) throw new TypeError(`${path} must hold an array of access-token entries`)
  return value
}

// Write to a temporary file beside the store, sync it, and rename it over,
// so neither a reader nor a crash ever leaves a partial store; the store is
// only ever readable by its owner.
const write_access_tokens = async (path: string, entries: readonly AccessToken[]): Promise<void> => {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    const file = await open(temporary, 'w', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(entries, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  const directory = await open(dirname(path), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

const LOCK_STALE_MS = 10_000
const LOCK_WAIT_MS = 5000

// Issue and revoke each read, change and rewrite the store, so two run at
// once would lose one change: each holds <store>.lock, created exclusively,
// and a lock older than LOCK_STALE_MS is taken as left by a dead command.
const with_store_lock = async <T>(path: string, change: () => Promise<T>): Promise<T> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lock = `${path}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await (await open(lock, 'wx', 0o600)).close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const held_since = await stat(lock).then(({ mtimeMs }) => mtimeMs, () => undefined)
      if (held_since !== undefined && Date.now() - held_since > LOCK_STALE_MS) await unlink(lock).catch(() => {})
      else if (Date.now() > deadline) throw new Error(`${lock} is held by another token command`)
      else await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    return await change()
  } finally {
    await unlink(lock).catch(() => {})
  }
}

const summary_of = ({ token_sha256: _hash, ...summary }: AccessToken): AccessTokenSummary => summary

// 32 random bytes in hex: inside the RFC 7230 token charset the bearer.
// subprotocol needs, and with the entropy that makes an unsalted hash safe.
export const issue_access_token = async ({ path, label, now = new Date() }: { path: string, label: string, now?: Date }): Promise<{ token: string, entry: AccessTokenSummary }> => await with_store_lock(path, async () => {
  const entries = await read_access_tokens(path)
  const ids = new Set(entries.map(({ id }) => id))
  let id: string
  do id = randomBytes(6).toString('hex'); while (ids.has(id))
  const token = randomBytes(32).toString('hex')
  const entry: AccessToken = { id, label, token_sha256: token_sha256(token), created_at: now.toISOString(), revoked_at: null }
  await write_access_tokens(path, [...entries, entry])
  return { token, entry: summary_of(entry) }
})

export const list_access_tokens = async (path: string): Promise<AccessTokenSummary[]> =>
  (await read_access_tokens(path)).map(summary_of)

export const revoke_access_token = async ({ path, id, now = new Date() }: { path: string, id: string, now?: Date }): Promise<AccessTokenSummary> => await with_store_lock(path, async () => {
  const entries = await read_access_tokens(path)
  const entry = entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`no access token ${id}`)
  if (entry.revoked_at !== null) return summary_of(entry)
  const revoked = { ...entry, revoked_at: now.toISOString() }
  await write_access_tokens(path, entries.map((candidate) => candidate === entry ? revoked : candidate))
  return summary_of(revoked)
})

export interface TokenAuthenticator {
  authenticate: Authenticate
  // Calls the listener whenever a changed store is read, and polls the
  // store's metadata while any listener is registered, so a revocation
  // reaches open event streams without waiting for a request.
  watch: (listener: () => void) => () => void
}

// A store that cannot be read or parsed is a fault on the node, not a bad
// token: it answers 503, never 401, since a client discards its token on a
// 401 (§8.7.3) and a store fault must not sign every device out.
const store_unavailable = (path: string, error: unknown): ApiError => {
  console.error(`access-token store ${path} unavailable: ${error instanceof Error ? error.message : String(error)}`)
  return new ApiError({ status: 503, code: 'INTERNAL_ERROR', message: 'the access-token store is unavailable' })
}

export const create_token_authenticator = ({ path, poll_interval_ms = 1000 }: { path: string, poll_interval_ms?: number }): TokenAuthenticator => {
  // The parsed active hashes, keyed on the file's identity and mtime: a
  // request costs one stat, and the rename in each write changes the inode.
  let cached: { key: string, hashes: Buffer[] } | undefined
  const listeners = new Set<() => void>()
  let timer: NodeJS.Timeout | undefined

  const active_hashes = async (): Promise<Buffer[]> => {
    let key: string
    try {
      const { ino, mtimeMs, size } = await stat(path)
      key = `${ino}:${mtimeMs}:${size}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw store_unavailable(path, error)
      key = 'missing'
    }
    if (cached?.key === key) return cached.hashes
    let entries: AccessToken[]
    try {
      entries = await read_access_tokens(path)
    } catch (error) {
      throw store_unavailable(path, error)
    }
    const changed = cached !== undefined
    cached = { key, hashes: entries.filter(({ revoked_at }) => revoked_at === null).map(({ token_sha256 }) => Buffer.from(token_sha256, 'hex')) }
    if (changed) for (const listener of listeners) listener()
    return cached.hashes
  }

  const authenticate: Authenticate = async (token) => {
    const hashes = await active_hashes()
    if (token === undefined || token === '') return false
    const presented = createHash('sha256').update(token).digest()
    let matched = false
    for (const hash of hashes) matched = timingSafeEqual(hash, presented) || matched
    return matched
  }

  const watch = (listener: () => void): () => void => {
    listeners.add(listener)
    timer ??= setInterval(() => { active_hashes().catch(() => {}) }, poll_interval_ms).unref()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }

  return { authenticate, watch }
}
