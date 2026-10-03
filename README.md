# record-node

Reference implementation of the Record Protocol v1: a peer that creates identities, keeps signed append-only libraries of audio entries, ingests audio, replicates with other peers, and exposes a derived query layer.

The spec in [record-docs](https://github.com/mistakia/record-docs) (`spec/`, chapters 1-7) is authoritative. Where this code and the spec disagree, the code is wrong; where the spec contradicts itself, the fix lands in record-docs as an erratum first.

## Status

Scaffold and conformance suite only. Every normative requirement in spec chapters 1-7 has a pending test under `test/conformance/`, named by section; each implementation stage turns its stubs into passing tests. The fixture vectors (F0-F6) are ported in `test/conformance/vectors.ts` and self-checked against the libraries the fixture generators use.

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
test/
  conformance/      spec vectors and one test per normative requirement
```

Cross-directory imports use the `#` aliases in `package.json` (for example `#encoding/cid.ts`).

The shipped core is Node-compatible: record-app embeds it in-process under Electron and nodejs-mobile, so no Bun-only API appears outside the CLI entry point and tests.

## Development

Requires [bun](https://bun.com) 1.4, plus `fpcalc` (Chromaprint) and `ffmpeg` for the content-processing stage.

```sh
bun install
bun run verify          # lint and typecheck
bun test                # full suite
bun run test:conformance
```

Supply chain: no dependency lifecycle script runs (`trustedDependencies` is empty), and `bunfig.toml` refuses any package version published less than seven days ago. CI re-checks the lockfile with `cli/check-lockfile-age.mjs`.

## License

MIT
