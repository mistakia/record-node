# record-node

Reference implementation of the Record Protocol v1: a peer that creates identities, keeps signed append-only libraries of audio entries, ingests audio, replicates with other peers, and exposes a derived query layer.

The spec in [record-docs](https://github.com/mistakia/record-docs) (`spec/`, chapters 1-7, at v1.1.0) is authoritative. Where this code and the spec disagree, the code is wrong; where the spec contradicts itself, the fix lands in record-docs as an erratum first.

## Status

The v1 peer is complete: protocol core (canonical encoding, identity and signing, access control, entries, the oplog and its CRDT merge), the content store (in-memory for tests, Helia with the spec section 5.5.1 import profile), content processing (fpcalc, ffmpeg, metadata, and the local, URL, and CID ingest pipelines), the derived query database, peer assembly with library lifecycle and pinning, the HTTP and WebSocket API served from `7-http-api.yaml`, and replication over the section 5.5.1 libp2p profile (gossipsub, the Record pre-shared key, bitswap, with bootstrap, mDNS, and DHT discovery): RECORD announcements, heads exchange, bounded fetch traversal, merge, and pause and resume. It implements spec v1.1.0: an identity library per identity recording its own libraries, links, and pins (§4.8); own libraries created and retired; capabilities with delegation, revocation, and inert entries (§3.5.5-§3.5.10); verified Lamport clocks (§4.2); node-local replication policy and pinned blobs (§4.6.1, §4.6.2); refusal of degenerate fingerprints and track-id collisions at ingest (§6.4.1); and chapter 7 at 1.1.0. Tests live under `test/conformance/` and `test/integration/`, named by spec section, and all of them pass. The fixture vectors F0-F11 are ported in `test/conformance/vectors.ts` and `capability-vector.ts`, including all 327 F10 capability verdicts.

The pre-v1 implementation (orbit-db / ipfs-log) is tagged `legacy-v0`. It is reference material, not a conformance target.

## Layout

```
src/
  encoding/         dag-cbor canonical encoder, CID builder, size bounds
  identity/         key pairs, signing, verification
  access-control/   AC chains, capabilities, FilterSpec, revocation
  entry/            entries, PUT/DEL operations, identity-library records
  oplog/            append-only DAG, heads, clock check, merge, current state,
                    inert entries, identity-library state
  fabric/           ContentStore, PubSub, and Network interfaces
  adapter/          libp2p (spec section 5.5.1) and in-memory backends
  replication/      announcement, heads exchange, traversal, merge orchestration
  ingest/           fingerprint, tag strip, metadata, artwork, pipelines
  query-db/         derived SQLite index
  peer/             assembly, identity library, own libraries and links,
                    write targets, capabilities, replication policy, blob
                    fetching and pins, listens, config, data-directory lock
  api/              HTTP and WebSocket API
  types/            shared and branded types
  index.ts          package entry: create_peer, the API server factory, load_config
  cli.ts            headless entry point
test/
  conformance/      spec vectors and one test per normative requirement
  integration/      one peer end to end over HTTP, and peers replicating over
                    the in-memory network and real libp2p on loopback
dist/               committed Node build of src/
```

Cross-directory imports use the `#` aliases in `package.json` (for example `#encoding/cid.ts`).

The shipped core is Node-compatible: record-app runs it under Node, on desktop as a child process spawned through Electron's utilityProcess (spec §8.3.1), so no Bun-only API appears outside the tests; the build compiles `src/` against Node types alone.

## Usage

As a library, the way record-app's node process loads it:

```js
import { create_api_server, create_peer, start_peer } from 'record-node'

const peer = await create_peer({ config: { data_dir: '/path/to/data' } })
await start_peer(peer)
await peer.ingest_file('/path/to/track.flac')
```

Headless, serving the API on `http://127.0.0.1:3000/api`:

```sh
record-node [--port <n>] [--data-dir <dir>] [--config <file>]
```

The data directory defaults to `~/.record`. A JSON config file (`--config` or `RECORD_CONFIG`) may set `port`, `host`, `cors_origins`, `data_dir`, `ffmpeg_path`, `fpcalc_path`, `ytdlp_path`, `network`, and the tuning fields of `src/peer/config.ts`. `network` is `false` for a peer that never connects, or an object whose omitted fields keep their mode's defaults. `mode` is one of the spec §5.6 network modes:

- `public` (default): `listen` (multiaddrs, default `["/ip4/0.0.0.0/tcp/0"]`), `announce_addresses` (public addresses the operator vouches are reachable; they replace the advertised addresses and are announced to the rendezvous without waiting on AutoNAT), `bootstrap` (multiaddrs with a `/p2p/` peer id, default none), `mdns`, `dht` and `upnp` (default `true`), `mainline_rendezvous` (`true`, `false`, or `{ port, lookup_interval_ms, dht_bootstrap }`, default on with a random UDP port), and `relay_server` (`false`, or `{ allowed_peer_ids }`: empty keeps libp2p's default limits for hole-punch coordination, a list reserves only for those peers with the limits lifted). AutoNAT, circuit relay and DCUtR always run.
- `masked`: needs `tor: { socks_address }` (`host:port`). Every connection goes out through Tor; the node listens on and advertises nothing, runs no rendezvous, LAN discovery or NAT traversal, and bootstraps from the nano-community VPS node unless `bootstrap` says otherwise.
- `relayed`: needs `relay_address` (a multiaddr ending `/p2p/<relay peer id>`). The node listens and advertises only its circuit on that relay and dials nothing else; its DHT serves once the reservation stands.

A key a mode fixes may be omitted or repeat the mode's value; anything else is refused. `census: true` (needs a data directory and a network) keeps the aggregate network census under `<data_dir>/census`, one JSONL row per UTC day, served at `GET /api/network-census?date=YYYY-MM-DD` (not part of the spec). The identify agent string is `record-node/<major>.<minor> (<mode>)`. `cors_origins` lists the origins a browser page may call the API from. A request or WebSocket upgrade carrying any other `Origin` is refused with 403, and the origin `null` is never allowed. When it is unset, the spec §8.7.5 known-client default applies, which is empty at v1, so no page is admitted; a configured list, `[]` included, replaces it. The heads and announcement intervals refuse values below the spec's 1000 ms and 5 s.

The node takes an exclusive lock on its data directory before opening anything in it (spec §8.4.6), held until it stops and released by the OS if it dies. A second node on the same directory fails with `DataDirectoryLocked`, and the CLI exits with status 75.

REST requests carry `Authorization: Bearer <token>` and the WebSocket offers the subprotocols `record` and `bearer.<token>` when the host passes `authenticate` to `create_api_server`; a node bound to loopback may run without it. A query-string token is never accepted.

Each linked library replicates audio and artwork under a node-local policy (spec §4.6.1), stored in `libraries.json` and set with `PUT /api/libraries/<address>/replication-policy`. Own libraries are `full`. A link recorded in the identity library defaults to `full` and one carried over from a v1.0 Log entry to `index_only`; `selective` keeps the tracks a FilterSpec matches. Blobs a policy or a pin record keeps are fetched from peers and pinned, at most `traversal_concurrency` at once, each within `blob_fetch_timeout_ms`, and retried under backoff. In `index_only`, `GET /api/audio/<cid>` streams from peers when the blob is not local, within `audio_fetch_timeout_ms`, and never pins; the blocks it fetched are kept up to `audio_cache_max_bytes` and evicted least recently used first, never while pinned. `HEAD` reports local availability only. Ingest requires ffmpeg 7.1.1 and fpcalc 1.5.1, the versions the spec's F7 vectors were produced with; on any other version the peer runs with ingest disabled. URL ingest resolves through [record-resolver](https://github.com/mistakia/record-resolver), which needs its pinned yt-dlp. A URL to resolve, every connection yt-dlp makes while resolving it (through record-resolver's guarded proxy), and every hop of the audio download including each redirect, must reach a public address: private, loopback, link-local and the other non-global ranges are refused after DNS resolution, and a refused URL is a 400.

## Development

Requires [bun](https://bun.com) 1.4, plus `fpcalc` (Chromaprint) 1.5.1 and `ffmpeg` 7.1.1 for the content-processing tests. On a machine without those versions, `RECORD_TOOLCHAIN_PREFLIGHT=bypass` runs the suite on whatever is installed and skips the byte-level pin checks; CI runs the pinned binaries without it.

```sh
bun install --ignore-scripts
bun run verify          # lint, typecheck, and check dist/ is current
bun test                # full suite; network tests stay on loopback
bun run test:conformance
bun run build           # rebuild dist/ after changing src/
sh test/smoke/git-dependency.sh   # install HEAD as a git dependency and run it under Node
```

`dist/` is committed because consumers install this package as a git dependency with install scripts disabled, and Node does not strip types under `node_modules`. The `#` aliases resolve to `src/` under Bun and to `dist/` under Node.

Supply chain: no dependency lifecycle script runs (`trustedDependencies` is empty), and `bunfig.toml` refuses any package version published less than seven days ago. CI re-checks the lockfile with `cli/check-lockfile-age.mjs`.

## License

MIT
