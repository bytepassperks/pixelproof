#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pages_url="${1:-https://pixelproof.pages.dev}"

[[ -f "$repo_root/_headers" ]] ||
  { echo "deploy check failed: missing $repo_root/_headers" >&2; exit 1; }

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # Wrangler's current release requires Node 22.
  source "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null
fi

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_WAMOJO_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
[[ -n "$CLOUDFLARE_API_TOKEN" ]] ||
  { echo "CLOUDFLARE_API_TOKEN or CLOUDFLARE_WAMOJO_API_TOKEN is required" >&2; exit 1; }

npx --yes wrangler@latest pages deploy "$repo_root" \
  --project-name pixelproof \
  --branch main

"$repo_root/scripts/check-pages-assets.sh" "$pages_url"
