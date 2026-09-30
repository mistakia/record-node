#!/usr/bin/env bash
# Run the install step of the few dependencies the test suite actually loads.
#
# .yarnrc sets `ignore-scripts true`, so `yarn install` leaves every native
# build and binary download undone. Yarn 1 has no per-package allowlist (the
# Berry `dependenciesMeta.built` pattern), so this script is that allowlist:
# only the packages named here get their install step, and every other
# lifecycle script in the tree stays blocked.
#
#   leveldown (x2)  native addon; no darwin-arm64 prebuild ships
#   sqlite3         native addon; its prebuilt-binary host (mapbox S3) now 403s
#   go-ipfs         postinstall downloads the ipfs daemon the tests spawn
#   youtube-dl      postinstall downloads the extractor record-resolver shells to
#
# Run from the repo root after `yarn install`.
set -euo pipefail

# Use npm's own node-gyp. sqlite3@5.0.0 pulls in node-gyp@3.8 and hoists it,
# which is what node-gyp-build and node-pre-gyp would otherwise pick up. It
# needs Python 2 and cannot run on a current runner.
gyp="$(npm prefix -g)/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
[ -f "$gyp" ] || { echo "npm-bundled node-gyp not found at $gyp" >&2; exit 1; }
export npm_config_node_gyp="$gyp"
export npm_config_python="${npm_config_python:-$(command -v python3)}"

for dir in node_modules/leveldown node_modules/orbit-db-keystore/node_modules/leveldown; do
  if (cd "$dir" && node -e "require('node-gyp-build')('.')" 2>/dev/null); then
    echo "$dir: prebuild loads"
  else
    echo "$dir: compiling"
    (cd "$dir" && node "$gyp" rebuild)
  fi
done

(cd node_modules/sqlite3 && node ../node-pre-gyp/bin/node-pre-gyp install --fallback-to-build)

# go-ipfs 0.8.0 publishes no darwin-arm64 build, and its arch lookup returns
# undefined for arm64. Take the amd64 build, which runs under Rosetta.
if [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ]; then
  export TARGET_ARCH=amd64
fi
(cd node_modules/go-ipfs && node src/post-install.js)
node -e "require('go-ipfs').path()"

# The package's own postinstall first runs `bin-version-check python`, which
# needs a `python` on PATH at install time. Call the download directly. It
# exits 0 even on failure, so check that the binary actually landed.
(cd node_modules/youtube-dl && node scripts/download.js)
[ -x node_modules/youtube-dl/bin/youtube-dl ] || { echo "youtube-dl binary missing" >&2; exit 1; }
