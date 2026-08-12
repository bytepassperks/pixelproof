#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://pixelproof.pages.dev}"
base_url="${base_url%/}"
model_mirror="https://pub-a8d1cffdfd404e2da5d08c1f0a266934.r2.dev"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

assets=(
  index.html
  app.html
  activate.html
  privacy-policy
  terms
  refunds
  contact
  styles.css
  vendor/fonts/alternatives/PlusJakartaSans-Latin.woff2
  app.js
  activation.js
  background-removal.js
  background-worker.js
  config.js
  entitlements.js
  privacy.js
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
  robots.txt
  sitemap.xml
  favicon.svg
  social-preview.svg
  vendor/images/pixelproof-cat-cutout.webp
  vendor/images/pixelproof-sample-photo.jpg
  vendor/images/pixelproof-comparison-photo.jpg
  404.html
  vendor/heic/libheif.js
  vendor/heic/libheif.wasm
  vendor/pdf-lib/pdf-lib.min.js
  vendor/avif/encode.js
  vendor/avif/meta.js
  vendor/avif/utils.js
  vendor/avif/codec/pre.js
  vendor/avif/codec/enc/avif_enc.js
  vendor/avif/codec/enc/avif_enc.wasm
  vendor/onnxruntime/ort.min.mjs
  vendor/onnxruntime/ort-wasm-simd-threaded.jsep.mjs
  vendor/onnxruntime/ort-wasm-simd-threaded.jsep.wasm
  vendor/onnxruntime/ort-wasm-simd-threaded.mjs
  vendor/onnxruntime/ort-wasm-simd-threaded.wasm
  pdf.js
  pdf-worker.js
)

model_assets=(
  "efficient-sam-vitt-encoder.onnx:24799761"
  "efficient-sam-vitt-decoder.onnx:16565728"
  "vitmatte-small-composition-1k.onnx:103885865"
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

for model_spec in "${model_assets[@]}"; do
  model="${model_spec%%:*}"
  expected_bytes="${model_spec##*:}"
  body="$tmp_dir/model-$model"
  content_type="$(
    curl --fail --silent --show-error --location \
      --output "$body" --write-out '%{content_type}' \
    "$model_mirror/$model"
  )"
  [[ "$content_type" != text/html* ]] ||
    { echo "asset check failed: model $model returned HTML" >&2; exit 1; }
  actual_bytes="$(wc -c < "$body")"
  [[ "$actual_bytes" == "$expected_bytes" ]] ||
    { echo "asset check failed: model $model is $actual_bytes bytes, expected $expected_bytes" >&2; exit 1; }
  printf 'ok %-24s model %s bytes\n' "$model" "$actual_bytes"
done
