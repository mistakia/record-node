# record-node

Reference implementation of the Record Protocol v1: a peer that creates identities, keeps signed append-only libraries of audio entries, ingests audio, replicates with other peers, and exposes a derived query layer.

The spec in [record-docs](https://github.com/mistakia/record-docs) (`spec/`, chapters 1-7) is authoritative. Where this code and the spec disagree, the code is wrong; where the spec contradicts itself, the fix lands in record-docs as an erratum first.

## Status

A single peer is complete: protocol core (canonical encoding, identity and signing, access control, entries, the oplog and its CRDT merge), the content store (in-memory for tests, Helia with the spec section 5.5.1 import profile), content processing (fpcalc, ffmpeg, metadata, and the local, URL, and CID ingest pipelines), the derived query database, peer assembly with library lifecycle and pinning, and the HTTP and WebSocket API served from `7-http-api.yaml`. Every normative requirement in spec chapters 1-7 has a test under `test/conformance/`, named by section. All pass except the section 5 network and replication tests, which land with the replication stage. The fixture vectors (F0-F7) are ported in `test/conformance/vectors.ts`.

The pre-v1 implementation (orbit-db / ipfs-log) is tagged `legacy-v0`. It is reference material, not a conformance target.

## Layout

```
src/
  encoding/         dag-cbor canonical encoder, CID builder, size bounds
  identity/         key pairs, signing, verification
  access-control/   AC chain creation, resolution, membership
  entry/            unsigned and signed entries, PUT/DEL operations
  oplog/            append-only DAG, heads, Lamport clock, merge, current state
  fabric/           ContentStore and PubSub interfaces
  adapter/          libp2p (spec section 5.5.1) and in-memory backends
  replication/      announcement, heads exchange, traversal, merge orchestration
  ingest/           fingerprint, tag strip, metadata, artwork, pipelines
  query-db/         derived SQLite index
  peer/             assembly, library lifecycle, listens, config
  api/              HTTP and WebSocket API
  types/            shared and branded types
  index.ts          package entry: create_peer, the API server factory, load_config
  cli.ts            headless entry point
test/
  conformance/      spec vectors and one test per normative requirement
  integration/      the single-peer stage gate, end to end over HTTP
dist/               committed Node build of src/
```

Cross-directory imports use the `#` aliases in `package.json` (for example `#encoding/cid.ts`).

The shipped core is Node-compatible: record-app embeds it in-process under Electron and nodejs-mobile, so no Bun-only API appears outside the tests; the build compiles `src/` against Node types alone.

## Usage

As a library, the way record-app embeds it:

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

The data directory defaults to `~/.record`. A JSON config file (`--config` or `RECORD_CONFIG`) may set `port`, `host`, `data_dir`, `ffmpeg_path`, `fpcalc_path`, `ytdlp_path`, and the tuning fields of `src/peer/config.ts`. Ingest requires ffmpeg 7.1.1 and fpcalc 1.5.1, the versions the spec's F7 vectors were produced with; on any other version the peer runs with ingest disabled. URL ingest resolves through [record-resolver](https://github.com/mistakia/record-resolver), which needs its pinned yt-dlp.

## Development

Requires [bun](https://bun.com) 1.4, plus `fpcalc` (Chromaprint) 1.5.1 and `ffmpeg` 7.1.1 for the content-processing tests. On a machine without those versions, `RECORD_TOOLCHAIN_PREFLIGHT=bypass` runs the suite on whatever is installed and skips the byte-level pin checks; CI runs the pinned binaries without it.

```sh
bun install --ignore-scripts
bun run verify          # lint, typecheck, and check dist/ is current
bun test                # full suite, offline
bun run test:conformance
bun run build           # rebuild dist/ after changing src/
sh test/smoke/git-dependency.sh   # install HEAD as a git dependency and run it under Node
```

`dist/` is committed because consumers install this package as a git dependency with install scripts disabled, and Node does not strip types under `node_modules`. The `#` aliases resolve to `src/` under Bun and to `dist/` under Node.

Supply chain: no dependency lifecycle script runs (`trustedDependencies` is empty), and `bunfig.toml` refuses any package version published less than seven days ago. CI re-checks the lockfile with `cli/check-lockfile-age.mjs`.

## License

MIT
