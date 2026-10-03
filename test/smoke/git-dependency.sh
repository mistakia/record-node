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

printf '{ "name": "record-node-git-smoke", "private": true, "type": "module" }\n' > "$project/package.json"
cp "$repo/test/smoke/git-dependency.mjs" "$project/smoke.mjs"

# npm, since bun takes no git+file dependency. --before is the repo's 7-day
# release-age floor (bunfig.toml) for every package the install resolves.
before=$(node -e 'console.log(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())')
cd "$project"
npm install --ignore-scripts --no-audit --no-fund --before "$before" "git+file://$repo#$commit"
test -f node_modules/record-node/dist/index.js
node smoke.mjs "$repo/test/fixtures/audio/sine-sweep-5s.flac"
