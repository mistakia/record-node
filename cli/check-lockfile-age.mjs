#!/usr/bin/env node
// Refuse lockfile changes that introduce a package@version published less than
// --days days ago. Works on the textual diff of any lockfile format; this repo's
// lockfile is bun.lock, whose package entries read "name": ["name@version", ...].
// A version whose publish time cannot be verified fails closed. See:
//   user:guideline/npm-supply-chain-hygiene.md (Minimum Release Age)
//   user:text/software-dev/supply-chain-defense-posture.md
//
// Usage:
//   node check-lockfile-age.mjs [lockfile] [--base <ref>] [--days N]
//
// Defaults: lockfile auto-detected, --base HEAD, --days 7.
// Override per-entry by listing `pkg@version` in .youngpkg-allow at repo root.
// Exit 0 = clean. Exit 1 = at least one too-young package. Exit 2 = usage error.

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]
  else positional.push(a)
}

const lockfile = positional[0] || autoDetectLockfile()
const days = Number(flags.days ?? 7)
const base = flags.base ?? 'HEAD'

if (!lockfile || !existsSync(lockfile)) {
  console.error(`No lockfile found (tried: ${lockfile || 'auto-detect'})`)
  process.exit(2)
}

const allowFile = '.youngpkg-allow'
const allow = existsSync(allowFile)
  ? new Set(
    readFileSync(allowFile, 'utf8')
      .split('\n')
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean)
  )
  : new Set()

let addedText
try {
  const diff = execSync(`git diff ${base} -- ${lockfile}`, { encoding: 'utf8' })
  addedText = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n')
  if (!addedText.trim()) {
    console.error(`OK: no additions in ${lockfile} vs ${base}.`)
    process.exit(0)
  }
} catch {
  // No git base available (fresh shallow clone, unborn ref); fall back to
  // scanning the whole lockfile. Steady-state CI shouldn't hit this path.
  addedText = readFileSync(lockfile, 'utf8')
}

const re =
  /(?:^|[^a-z0-9_-])((?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+)@(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?)\b/gi
const candidates = new Set()
for (const m of addedText.matchAll(re)) candidates.add(`${m[1]}@${m[2]}`)

const cutoff = Date.now() - days * 86_400_000
const violations = []
const unverified = []
const registryCache = new Map()

for (const spec of candidates) {
  if (allow.has(spec)) continue
  const at = spec.lastIndexOf('@')
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  // The full packument, not the abbreviated install-v1 document: only the
  // full form carries `time`, and without it every lookup used to skip.
  let meta = registryCache.get(name)
  if (meta === undefined) {
    try {
      const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
        headers: { accept: 'application/json' }
      })
      meta = r.status === 404 ? null : r.ok ? await r.json() : { error: `HTTP ${r.status}` }
    } catch (err) {
      meta = { error: err.message }
    }
    registryCache.set(name, meta)
  }
  // Not on the public registry (a name fragment from a git or tarball URL).
  if (meta === null) continue
  const t = meta.time?.[version]
  if (!t) {
    unverified.push({ spec, reason: meta.error ?? 'no publish time in registry metadata' })
    continue
  }
  if (new Date(t).getTime() > cutoff) {
    violations.push({ spec, published: t })
  }
}

for (const u of unverified) console.error(`Unverified: ${u.spec}  (${u.reason})`)

if (violations.length) {
  console.error(
    `Refusing ${lockfile}: ${violations.length} package(s) published in last ${days} days:`
  )
  for (const v of violations) console.error(`  ${v.spec}  (published ${v.published})`)
  console.error(`Override: add to ${allowFile} (one "pkg@version" per line) or rerun with --days N.`)
  process.exit(1)
}

if (unverified.length) {
  console.error(`Refusing ${lockfile}: ${unverified.length} package(s) with no verifiable publish time.`)
  process.exit(1)
}

console.error(`Checked ${candidates.size} package(s).`)
console.error(`OK: no package@version younger than ${days} days in ${lockfile} diff vs ${base}.`)

function autoDetectLockfile () {
  for (const f of ['bun.lock', 'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml']) {
    if (existsSync(f)) return f
  }
  return null
}
