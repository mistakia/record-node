// The access-token store and its authenticator (src/api/access-tokens.ts).

import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { create_token_authenticator, issue_access_token, list_access_tokens, revoke_access_token } from '#api/access-tokens.ts'
import { ApiError } from '#api/middleware.ts'

const store_path = (): string => join(mkdtempSync(join(tmpdir(), 'record-tokens-')), 'data', 'access-tokens.json')

// The RFC 7230 token charset the bearer. subprotocol carries (7-http-api.yaml).
const TOKEN_CHARS = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,2048}$/

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(check()).toBe(true)
}

describe('access tokens', () => {
  test('an issued token authenticates, and the store holds only its hash, readable by its owner alone', async () => {
    const path = store_path()
    const { token, entry } = await issue_access_token({ path, label: 'phone' })
    expect(token).toMatch(TOKEN_CHARS)
    expect(entry).toMatchObject({ label: 'phone', revoked_at: null })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).not.toContain(token)
    const { authenticate } = create_token_authenticator({ path })
    expect(await authenticate(token)).toBe(true)
    expect(await authenticate(`${token}0`)).toBe(false)
    expect(await authenticate(undefined)).toBe(false)
    expect(await list_access_tokens(path)).toEqual([entry])
    expect(JSON.stringify(await list_access_tokens(path))).not.toContain('token_sha256')
  })

  test('a revoked token is refused by a running authenticator without a reload', async () => {
    const path = store_path()
    const { token, entry } = await issue_access_token({ path, label: 'phone' })
    const kept = await issue_access_token({ path, label: 'laptop' })
    const { authenticate } = create_token_authenticator({ path })
    expect(await authenticate(token)).toBe(true)
    const revoked = await revoke_access_token({ path, id: entry.id })
    expect(revoked.revoked_at).not.toBeNull()
    expect(await authenticate(token)).toBe(false)
    expect(await authenticate(kept.token)).toBe(true)
    await expect(revoke_access_token({ path, id: 'missing' })).rejects.toThrow('no access token missing')
  })

  test('a missing store and a store with no active token refuse every token', async () => {
    const path = store_path()
    expect(await create_token_authenticator({ path }).authenticate('anything')).toBe(false)
    const { token, entry } = await issue_access_token({ path, label: 'phone' })
    await revoke_access_token({ path, id: entry.id })
    expect(await create_token_authenticator({ path }).authenticate(token)).toBe(false)
  })

  test('an unparseable or unreadable store is a 503, never a 401', async () => {
    const path = store_path()
    const { token } = await issue_access_token({ path, label: 'phone' })
    const { authenticate } = create_token_authenticator({ path })
    writeFileSync(path, '{ not json')
    const corrupted = await Promise.resolve(authenticate(token)).catch((error: unknown) => error)
    expect(corrupted).toBeInstanceOf(ApiError)
    expect((corrupted as ApiError).status).toBe(503)
    writeFileSync(path, JSON.stringify([{ id: 'x' }]))
    expect(((await Promise.resolve(authenticate(token)).catch((error: unknown) => error)) as ApiError).status).toBe(503)
    if (process.getuid?.() !== 0) {
      await issue_access_token({ path: `${path}.fresh`, label: 'phone' })
      chmodSync(`${path}.fresh`, 0o000)
      const unreadable = create_token_authenticator({ path: `${path}.fresh` })
      expect(((await Promise.resolve(unreadable.authenticate(token)).catch((error: unknown) => error)) as ApiError).status).toBe(503)
    }
  })

  test('concurrent issues and revokes lose no change', async () => {
    const path = store_path()
    const first = await issue_access_token({ path, label: 'phone' })
    const [, ...issued] = await Promise.all([
      revoke_access_token({ path, id: first.entry.id }),
      ...Array.from({ length: 5 }, async (_, index) => await issue_access_token({ path, label: `device ${index}` }))
    ])
    const listed = await list_access_tokens(path)
    expect(listed).toHaveLength(6)
    expect(listed.find(({ id }) => id === first.entry.id)?.revoked_at).not.toBeNull()
    const { authenticate } = create_token_authenticator({ path })
    for (const { token } of issued) expect(await authenticate(token)).toBe(true)
    expect(await authenticate(first.token)).toBe(false)
  })

  test('a watcher hears a revocation without any request', async () => {
    const path = store_path()
    const { token, entry } = await issue_access_token({ path, label: 'phone' })
    const { authenticate, watch } = create_token_authenticator({ path, poll_interval_ms: 10 })
    expect(await authenticate(token)).toBe(true)
    let changes = 0
    const unwatch = watch(() => { changes++ })
    try {
      await revoke_access_token({ path, id: entry.id })
      await until(() => changes === 1)
    } finally {
      unwatch()
    }
  })
})
