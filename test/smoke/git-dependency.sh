#!/bin/sh
# Installs record-node the way record-app does, as a git dependency with
# install scripts off, into a scratch project, then runs it under plain Node:
# import the package, create a peer, ingest the F7 file. Proves the committed
# dist/ and its # aliases load from node_modules with no build step.
#
#   sh test/smoke/git-dependency.sh [<commit>]   (default HEAD; must be committed)
#
# Honors RECORD_TOOLCHAIN_PREFLIGHT=bypass like the test helpers.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
commit=${1:-$(git -C "$repo" rev-parse HEAD)}
project=$(mktemp -d "${TMPDIR:-/tmp}/record-node-git-smoke.XXXXXX")
trap 'rm -rf "$project"' EXIT

# The same 7-day release-age floor and empty lifecycle allowlist as the repo.
cp "$repo/bunfig.toml" "$project/bunfig.toml"
printf '{ "name": "record-node-git-smoke", "private": true, "type": "module", "trustedDependencies": [] }\n' > "$project/package.json"
cp "$repo/test/smoke/git-dependency.mjs" "$project/smoke.mjs"

cd "$project"
bun add --ignore-scripts "record-node@git+file://$repo#$commit"
test -f node_modules/record-node/dist/index.js
node smoke.mjs "$repo/test/fixtures/audio/sine-sweep-5s.flac"
