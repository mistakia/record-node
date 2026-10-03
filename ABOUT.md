---
title: record-node Repository Graph Entry
type: text
description: >-
  Graph entry point for record-node, the Record Protocol v1 reference implementation; holds the
  invariants an agent must keep (committed dist/, toolchain pins, node:sqlite, the 5.5.1 audio
  import profile, index-only replication) and known upstream issues.
base_uri: user:repository/active/record-node/ABOUT.md
created_at: '2026-10-03T04:29:32.144Z'
entity_id: ae37dcd7-a1d5-4982-b594-09cd6609d37e
owner_identity_uri: user:identity/trashman.md
public_read: false
tags:
  - user:tag/record-project.md
updated_at: '2026-10-03T04:29:32.144Z'
---

## Purpose

Reference implementation of Record Protocol v1: a Node-compatible peer covering protocol core, content store, content processing, query database, HTTP and WebSocket API, and libp2p replication. The spec it conforms to is canonical in [[user:repository/active/record-docs/ABOUT.md]] (`spec/`), never restated here. Build, layout and config are in [[README.md]].

## Invariants

- **Committed `dist/`.** Consumers install this package as a git dependency with install scripts disabled, so the Node build is committed. `bun run verify` runs `check:dist`, which fails when `dist/` is stale; run `bun run build` after changing `src/`.
- **Toolchain pins.** Ingest requires ffmpeg 7.1.1 and fpcalc 1.5.1, the versions the spec's F7 vectors were produced with. On any other version the peer runs with ingest disabled. `RECORD_TOOLCHAIN_PREFLIGHT=bypass` runs the suite on a non-pinned machine and skips the byte-level checks; CI runs the pinned binaries without it.
- **Query database is `node:sqlite`** (`DatabaseSync`), so there is no native addon to build.
- **Audio import profile.** Writers import audio with the IPIP-499 `unixfs-v1-2025` profile (spec 5.5.1) so `content.hash` is stable across peers; readers accept any valid CID.
- **Index-only replication.** Until the spec v1.1.0 replication-policy API (8.6.5a full, selective, index_only) lands with the record-app rebuild, a peer replicates entries but not audio. `GET /api/audio/<cid>` fetches a missing blob from peers over bitswap within `audio_fetch_timeout_ms`, never pins it, and keeps fetched blocks in an LRU bounded by `audio_cache_max_bytes`. `HEAD` reports local availability only.

## Known issues

- `@helia/bitswap` never sends a cancel after a block arrives, so the serving peer ignores a later want for the same block on the same connection. An evicted block is refetchable only from another peer or after reconnect.
- Bun 1.4 `node:crypto` lacks `chacha20-poly1305`, so the noise layer falls back to pure-JS crypto under Bun.

## Notable Context

- **Tag**: [[user:tag/record-project.md]]
- **Task directory**: [[user:task/record/]] — the v1 rewrite plan and its stage record are in [[user:task/record/record-protocol-v1-reference-impl.md]].
- **Sibling**: [[user:repository/active/record-docs/ABOUT.md]] (spec), `record-resolver` (URL ingest), [[user:repository/active/record-app/ABOUT.md]] (client).
