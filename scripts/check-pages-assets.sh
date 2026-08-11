#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://pixelproof.pages.dev}"
base_url="${base_url%/}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

assets=(
  index.html
  app.html
  activate.html
  styles.css
  app.js
  activation.js
  background-removal.js
  background-worker.js
  config.js
  entitlements.js
  landing.js
  registry.js
  worker.js
  heic-decoder-worker.js
  zip.js
  metadata.js
  heic.js
  sw.js
  manifest.webmanifest
  THIRD_PARTY_NOTICES
  vendor/heic/libheif.js
  vendor/heic/libheif.wasm
  vendor/pdf-lib/pdf-lib.min.js
  pdf.js
  pdf-worker.js
)

for asset in "${assets[@]}"; do
  body="$tmp_dir/body"
  content_type="$(
    curl --fail --silent --show-error --location \
      --output "$body" --write-out '%{content_type}' \
      "$base_url/$asset"
  )"
  case "$asset" in
    *.js)
      [[ "$content_type" == application/javascript* ]] ||
        { echo "asset check failed: $asset served as $content_type" >&2; exit 1; }
      ! grep -qi '<!doctype html' "$body" ||
        { echo "asset check failed: $asset contains HTML" >&2; exit 1; }
      ;;
    *.webmanifest)
      [[ "$content_type" == application/manifest+json* || "$content_type" == application/json* ]] ||
        { echo "asset check failed: $asset served as $content_type" >&2; exit 1; }
      ;;
    *.wasm)
      [[ "$content_type" == application/wasm* ]] ||
        { echo "asset check failed: $asset served as $content_type" >&2; exit 1; }
      ;;
    *.css)
      [[ "$content_type" == text/css* ]] ||
        { echo "asset check failed: $asset served as $content_type" >&2; exit 1; }
      ;;
    *.html)
      [[ "$content_type" == text/html* ]] ||
        { echo "asset check failed: $asset served as $content_type" >&2; exit 1; }
      ;;
  esac
  printf 'ok %-24s %s\n' "$asset" "$content_type"
done
