#!/bin/sh
# Installs the pinned ingest toolchain (spec §6.1.5, §6.2.4): ffmpeg 7.1.1 and
# fpcalc 1.5.1, the versions src/ingest/toolchain.ts requires. This file is the
# one home of the artifact pins; CI, record-app, and the canonical node's setup
# run it rather than restating them.
#
# ffmpeg comes from the mwader/static-ffmpeg:7.1.1 image, index digest
# sha256:11a44711684c0b9f754c047dcd64235b8b52deab251bd0e0a86f22faa160749c. Its
# linux/amd64 manifest (sha256:6769881c...) has one layer, fetched here by
# digest through the registry API, so no docker is needed. fpcalc is
# Chromaprint's release tarball. Every download and every installed binary is
# checked by SHA-256. Upstream fpcalc has no linux-arm64 build, and no static
# ffmpeg 7.1.1 for macOS is pinned here, so only linux x86_64 is supported.
#
# Usage: cli/fetch-toolchain.sh [BIN_DIR]   install, then print BIN_DIR
#        cli/fetch-toolchain.sh --print-bin-dir   print the default, fetch nothing
# BIN_DIR defaults to $RECORD_TOOLCHAIN_DIR, else
# ${XDG_CACHE_HOME:-$HOME/.cache}/record-node/toolchain, under a directory
# named for the pins so a bump never reuses an old install.

set -eu

FFMPEG_VERSION=7.1.1
FFMPEG_IMAGE=mwader/static-ffmpeg
FFMPEG_LAYER_SHA256=a3d5cbcd66e675b1f398d56c7ca0246daa5987004395f5a8361bfacc46a00be2
FFMPEG_SHA256=810f94020e76e2b58fb44759a322e86bea5d213ebededad7471f3a15b0bf2c5c
FPCALC_VERSION=1.5.1
FPCALC_URL="https://github.com/acoustid/chromaprint/releases/download/v$FPCALC_VERSION/chromaprint-fpcalc-$FPCALC_VERSION-linux-x86_64.tar.gz"
FPCALC_TARBALL_SHA256=4d7433a7f778e5946d7225230681cbcd634e153316ecac87c538c33ac32387a5
FPCALC_SHA256=085a1adf67b4a71a2e57b7b05bc425c1ea21b371b2b43049fc8ba37b53cb472b

default_bin_dir() {
  root="${RECORD_TOOLCHAIN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/record-node/toolchain}"
  echo "$root/ffmpeg-$FFMPEG_VERSION-fpcalc-$FPCALC_VERSION/bin"
}

if [ "${1:-}" = --print-bin-dir ]; then
  default_bin_dir
  exit 0
fi

if [ "$(uname -s)-$(uname -m)" != Linux-x86_64 ]; then
  echo "fetch-toolchain: only linux x86_64 has pinned artifacts (got $(uname -s)-$(uname -m))" >&2
  exit 1
fi

BIN_DIR="${1:-$(default_bin_dir)}"

is_pinned() { [ -f "$1" ] && echo "$2  $1" | sha256sum -c --status - 2>/dev/null; }

if is_pinned "$BIN_DIR/ffmpeg" "$FFMPEG_SHA256" && is_pinned "$BIN_DIR/fpcalc" "$FPCALC_SHA256"; then
  echo "$BIN_DIR"
  exit 0
fi

mkdir -p "$BIN_DIR"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! is_pinned "$BIN_DIR/ffmpeg" "$FFMPEG_SHA256"; then
  echo "fetch-toolchain: fetching ffmpeg $FFMPEG_VERSION" >&2
  token=$(curl -fsS --proto '=https' "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$FFMPEG_IMAGE:pull" |
    sed -n 's/.*"token": *"\([^"]*\)".*/\1/p')
  [ -n "$token" ] || { echo "fetch-toolchain: no registry token for $FFMPEG_IMAGE" >&2; exit 1; }
  # The bearer token goes through a header file, so it never shows in argv.
  printf 'Authorization: Bearer %s\n' "$token" > "$tmp/auth-header"
  curl -fsSL --proto '=https' -H "@$tmp/auth-header" -o "$tmp/layer.tar.gz" \
    "https://registry-1.docker.io/v2/$FFMPEG_IMAGE/blobs/sha256:$FFMPEG_LAYER_SHA256"
  echo "$FFMPEG_LAYER_SHA256  $tmp/layer.tar.gz" | sha256sum -c --quiet -
  tar -xzf "$tmp/layer.tar.gz" -C "$tmp" ffmpeg
  echo "$FFMPEG_SHA256  $tmp/ffmpeg" | sha256sum -c --quiet -
  chmod 0755 "$tmp/ffmpeg"
  mv -f "$tmp/ffmpeg" "$BIN_DIR/ffmpeg"
fi

if ! is_pinned "$BIN_DIR/fpcalc" "$FPCALC_SHA256"; then
  echo "fetch-toolchain: fetching fpcalc $FPCALC_VERSION" >&2
  curl -fsSL --proto '=https' -o "$tmp/fpcalc.tar.gz" "$FPCALC_URL"
  echo "$FPCALC_TARBALL_SHA256  $tmp/fpcalc.tar.gz" | sha256sum -c --quiet -
  tar -xzf "$tmp/fpcalc.tar.gz" -C "$tmp" --strip-components=1 "chromaprint-fpcalc-$FPCALC_VERSION-linux-x86_64/fpcalc"
  echo "$FPCALC_SHA256  $tmp/fpcalc" | sha256sum -c --quiet -
  chmod 0755 "$tmp/fpcalc"
  mv -f "$tmp/fpcalc" "$BIN_DIR/fpcalc"
fi

echo "$BIN_DIR"
