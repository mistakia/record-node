#!/bin/sh
# Fails when the committed dist/ differs from a fresh build of src/.
set -eu
cd "$(dirname "$0")/.."
check_dir=.dist-check
trap 'rm -rf "$check_dir"' EXIT
sh cli/build-dist.sh "$check_dir"
if ! diff -r "$check_dir" dist; then
  echo 'dist/ is stale: run `bun run build` and commit dist/' >&2
  exit 1
fi
