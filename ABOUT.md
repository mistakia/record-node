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
observations:
  - >-
    [declassification] Released to public (required = ∅) via base entity visibility set: Operator
    approved 2026-10-06: clean context-file tranche (classifier clean + recheck confirm), public
    tier.
owner_identity_uri: user:identity/trashman.md
public_read: true
tags:
  - user:tag/record-project.md
updated_at: '2026-10-03T17:12:15.320Z'
visibility_analyzed_at: '2026-10-07T01:23:26.263Z'
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
- **Open reads entry blocks from the index, and re-verifies them only under new rules.** `index.sqlite` caches each library's verified entry blocks (`entry_blocks`), so an open reads its oplog in one scan instead of walking one block at a time from the heads, which on base-storage's direct-I/O image cost minutes. `entry_blocks` is a rowid table read in rowid order, so the scan reads the file forward; keyed by hash, a library's rows lie across the whole file and a cold open reads them at random, about 40 reads/s on base-storage. Every cache write also records the oplog heads and `VERIFICATION_RULES_VERSION` (`entry_blocks_verified`). A cache that reproduces those heads, matching the persisted heads, under the same version restores without signature or authorisation checks. Any other cache is verified in full, and one that does not reproduce the persisted heads is replaced by a walk. Bump `VERIFICATION_RULES_VERSION` (`src/oplog/accept.ts`) with any change to what `verify_entry` accepts, so the next open re-verifies every cached entry. Merged and replicated entries are always verified. The open's re-pin of every entry runs after the open returns, on the manager's pin queue: any release, an unlink's included, and an identity pin record's removal wait for it, so none decides on a pin set it has not filled. Stop cuts the pass short and refuses releases from then on.
- **Two signature backends.** Under Node, OpenSSL verifies secp256k1 signatures after noble parses the DER; under Bun and Electron (BoringSSL, no secp256k1) noble verifies alone. `bun test` only exercises noble, so `test/smoke/signature-node.ts` checks OpenSSL's verdicts against noble's in CI; keep it covering any change to verification.
- **Pins live in the pin index, not in Helia.** `pins.sqlite` holds each block's reference count and each pinned root's kind (`src/fabric/pin-index.ts`), shared by both content-store backends. It is derived: every open re-pins every entry and kept blob, so a missing or old-version index is refilled by that pass. Helia's pin API is unused, and a start deletes the `datastore/pin` and `datastore/pinned-block` directories older versions left, one file at a time in the background.
- **Tools run in the tool host.** fpcalc and ffmpeg run from one forked helper process (`src/ingest/tool-host.ts`), never from the node. On Linux a spawn copies the spawner's page tables, which at a large library's resident size blocked the node's event loop for about 23 ms per spawn.
- **The node locks its data directory.** An SQLite exclusive-mode lock on `<data_dir>/lock`, taken before anything else opens and released by the OS on process death (8.4.6). A second node fails with `DataDirectoryLocked`; the CLI exits 75.
- **Index and pin writes commit in batches.** Each disk-backed store's write connection defers COMMIT through a `CommitBatcher` (100 ms idle window, every 8 runs), so a batch of imports pays one commit stall instead of each paying its own; both stores are derived and a lost last batch is repaired at open. Only the node's own connection may write a live store: `open_query_db` and `open_pin_db` treat a locked database as a live writer and never delete it, and an external observer that needs committed state asks the peer to flush (`context.index_commit.flush()`) or reads through the node's API instead of opening the file. A second connection that writes anyway leaves the batch's COMMIT to fail at stop.
- **The network mode bounds every dial.** `network.mode` (spec 5.6) decides transports, services and the connection gater in `src/adapter/libp2p/node.ts`. A masked node's only direct transport is `tor-transport.ts`, which replaces `@libp2p/tcp`'s connect step and passes hostnames to SOCKS unresolved, so keep `@libp2p/tcp` pinned and its `_connect` check failing loudly. A relayed node's gater admits only its relay and circuit addresses through it, LAN included. Masked and relayed nodes resolve no `/dnsaddr` and have a DNS client that refuses, since libp2p resolves before the gater runs. Keep `identify_push` on: without it a relay never learns a reserved node's circuit address.
- **A relayed node keeps its reservation itself.** circuit-relay-v2 reserves on a configured relay once and drops it for good when the relay goes away, so `keep_relay_reservation` re-listens on the relay every 10 s while the node has no circuit address, and a relay that is down at start does not stop the node starting (`NO_FATAL`). It reaches libp2p's transport manager through its components and fails loudly if that moves.
- **A relayed node's DHT turns server only after its reservation.** A peer adds a DHT server to its routing table when identify first shows the protocol, with the addresses it holds then, so serving before the circuit address exists leaves the node unfindable by peer id (`serve_dht_once_reachable`).
- **The rendezvous announces only a verified public port.** `mainline-rendezvous.ts` announces the port of the first `getAddressesWithMetadata()` entry that is `verified && !isPrivate`. AutoNAT needs 4 dial-backs, so the network's first node (the VPS) sets `announce_addresses`; UPnP runs with `autoConfirmAddress`.
- **The census stores counts only.** `src/peer/census.ts` keeps peer ids as HMACs under a key drawn each Monday-to-Sunday UTC week and dropped at its end, in memory only. A row has no address, peer id, library address, or free text from an agent string, and rows older than 90 days are deleted. `GET /api/network-census` is mounted ahead of the OpenAPI validator because it is not in the spec.

## Known issues

- `@helia/bitswap` never sends a cancel after a block arrives, so the serving peer ignores a later want for the same block on the same connection. An evicted block is refetchable only from another peer or after reconnect.
- Bun 1.4 `node:crypto` lacks `chacha20-poly1305`, so the noise layer falls back to pure-JS crypto under Bun.
- Ingest on base-storage was bound by synchronous SQLite commits on the JS thread (pin index and query index), whose writes block on dirty-page throttling for the direct-I/O image while md1 is saturated. Commit batching (`src/fabric/commit-batch.ts`) shipped in 1de38ca and is deployed to the canonical node. The canonical ingest rate after it is still unmeasured. The only post-deploy stage so far, the 2026-10-08 label-fix resync, ran 44.25 files/s over mostly-absent 404s, which is not comparable with the 0.875-1.411 files/s pre-deploy import baseline. The bench ran 10.28 files/s at concurrency 8 before batching. Profile there with `scratch/record/lock-bench/bench-prof.sh` before optimising further: the local profile (SSD, macOS posix_spawn) located neither earlier limit.
- Capability verification is not incremental. Each grantee write walks its causal past once per revocation (spec 3.5.9 step 6), and a new revocation re-judges every delegated entry, so merge cost grows with delegated entries times revocations times log size. An owner-only library never takes that path. A heavily delegated one would need an incremental effective set and causal index.

## Notable Context

- **Tag**: [[user:tag/record-project.md]]
- **Task directory**: [[user:task/record/]] — the v1 rewrite plan and its stage record are in [[user:task/record/record-protocol-v1-reference-impl.md]].
- **Sibling**: [[user:repository/active/record-docs/ABOUT.md]] (spec), `record-resolver` (URL ingest), [[user:repository/active/record-app/ABOUT.md]] (client).
