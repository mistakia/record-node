#!/bin/sh
# Builds the shipped JavaScript into the given directory (default dist/):
# src/ compiled for Node, plus the vendored API spec the server loads beside
# its code. dist/ is committed because consumers install this package as a git
# dependency with install scripts disabled, and Node will not strip types
# under node_modules.
set -eu
cd "$(dirname "$0")/.."
out_dir=${1:-dist}
# Check before the rm, so a tree without node_modules keeps its dist/.
[ -x node_modules/.bin/tsc ] || { echo "build-dist: node_modules/.bin/tsc missing; run bun install" >&2; exit 1; }
rm -rf "$out_dir"
node_modules/.bin/tsc -p tsconfig.build.json --outDir "$out_dir"
cp src/api/7-http-api.yaml "$out_dir/api/7-http-api.yaml"
