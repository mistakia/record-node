---
title: record-node Repository Graph Entry
type: text
description: >-
  Graph entry point for record-node, the Record Protocol v1 reference implementation; holds the
  invariants an agent must keep (committed dist/, toolchain pins, node:sqlite, the 5.5.1 audio
  import profile, replication policy, derived identity-library state, the data-directory lock) and
  known upstream issues.
base_uri: user:repository/active/record-node/ABOUT.md
created_at: '2026-10-03T04:29:32.144Z'
entity_id: ae37dcd7-a1d5-4982-b594-09cd6609d37e
owner_identity_uri: user:identity/trashman.md
public_read: false
tags:
  - user:tag/record-project.md
updated_at: '2026-10-03T17:12:15.320Z'
---

## Purpose

Reference implementation of Record Protocol v1: a Node-compatible peer covering protocol core, content store, content processing, query database, HTTP and WebSocket API, and libp2p replication. The spec it conforms to is canonical in [[user:repository/active/record-docs/ABOUT.md]] (`spec/`), never restated here. Build, layout and config are in [[README.md]].

## Invariants

- **Committed `dist/`.** Consumers install this package as a git dependency with install scripts disabled, so the Node build is committed. `bun run verify` runs `check:dist`, which fails when `dist/` is stale; run `bun run build` after changing `src/`.
- **Toolchain pins.** Ingest requires ffmpeg 7.1.1 and fpcalc 1.5.1, the versions the spec's F7 vectors were produced with. On any other version the peer runs with ingest disabled. `RECORD_TOOLCHAIN_PREFLIGHT=bypass` runs the suite on a non-pinned machine and skips the byte-level checks; CI runs the pinned binaries without it.
- **Query database is `node:sqlite`** (`DatabaseSync`), so there is no native addon to build.
- **Audio import profile.** Writers import audio with the IPIP-499 `unixfs-v1-2025` profile (spec 5.5.1) so `content.hash` is stable across peers; readers accept any valid CID.
- **Replication policy decides audio.** Own libraries replicate audio and artwork in full; a linked library follows its node-local policy (spec 4.6.1): `full` by default for a link in the identity library, `index_only` for one carried over from a v1.0 Log entry. Pin records in the identity library keep their blobs on every device (4.6.2). In `index_only`, `GET /api/audio/<cid>` fetches a missing blob within `audio_fetch_timeout_ms`, never pins it, and keeps fetched blocks in an LRU bounded by `audio_cache_max_bytes`.
- **Identity-library state is derived.** Own libraries, links, pins, capabilities, and inert entries are computed from oplogs at open, never persisted beside them, so nothing can drift from the `index.sqlite` heads marker. Only the node-local replication policy is stored, in `libraries.json`.
- **Open reads entry blocks from the index, then re-verifies them.** `index.sqlite` caches each library's verified entry blocks (`entry_blocks`), so an open reads its oplog in one scan instead of walking one block at a time from the heads, which on base-storage's direct-I/O image cost minutes. A cache that does not reproduce the persisted heads is replaced by a walk. Every cached entry is still verified at open, so a rule a later version adds still applies. The open's re-pin of every entry runs after the open returns, on the manager's pin queue: any release, an unlink's included, and an identity pin record's removal wait for it, so none decides on a pin set it has not filled. Stop cuts the pass short and refuses releases from then on.
- **Two signature backends.** Under Node, OpenSSL verifies secp256k1 signatures after noble parses the DER; under Bun and Electron (BoringSSL, no secp256k1) noble verifies alone. `bun test` only exercises noble, so `test/smoke/signature-node.ts` checks OpenSSL's verdicts against noble's in CI; keep it covering any change to verification.
- **The node locks its data directory.** An SQLite exclusive-mode lock on `<data_dir>/lock`, taken before anything else opens and released by the OS on process death (8.4.6). A second node fails with `DataDirectoryLocked`; the CLI exits 75.

## Known issues

- `@helia/bitswap` never sends a cancel after a block arrives, so the serving peer ignores a later want for the same block on the same connection. An evicted block is refetchable only from another peer or after reconnect.
- Bun 1.4 `node:crypto` lacks `chacha20-poly1305`, so the noise layer falls back to pure-JS crypto under Bun.
- Ingest throughput on base-storage tops out near 8 files/s at concurrency 8, and the pin-lock fix (886e4a0) that gave 1.37x locally gave nothing there (2026-10-03, two bench.sh rounds, about 20% noise under live ingest). The local profile (synthetic FLAC on SSD) does not locate the base-storage limit; profile on base-storage before optimising ingest again.
- Capability verification is not incremental. Each grantee write walks its causal past once per revocation (spec 3.5.9 step 6), and a new revocation re-judges every delegated entry, so merge cost grows with delegated entries times revocations times log size. An owner-only library never takes that path. A heavily delegated one would need an incremental effective set and causal index.

## Notable Context

- **Tag**: [[user:tag/record-project.md]]
- **Task directory**: [[user:task/record/]] — the v1 rewrite plan and its stage record are in [[user:task/record/record-protocol-v1-reference-impl.md]].
- **Sibling**: [[user:repository/active/record-docs/ABOUT.md]] (spec), `record-resolver` (URL ingest), [[user:repository/active/record-app/ABOUT.md]] (client).
