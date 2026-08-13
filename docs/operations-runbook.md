# PixelProof operations and browser verification

This runbook covers the deployment and cross-browser checks needed before
claiming a PixelProof release is deployable.

## Cloudflare ownership and credentials

PixelProof's Cloudflare resources belong to account:

```text
ed43fb9aedda947029c20ca03959f5f4
```

Use the credential named `CLOUDFLARE_WAMOJO_API_TOKEN` for Worker, D1, Pages,
and R2 operations. Do not substitute `CLOUDFLARE_GETLAUNCHPOD_API_TOKEN`.
Never print or commit either token.

Resources:

- Worker: `pixelproof-license`
- D1 database: `pixelproof-licenses`
- D1 ID: `f9fd28ea-edaf-459b-9210-ddefa75dfc07`
- R2 bucket: `pixelproof-models`
- Pages project: `pixelproof`
- Live Worker: `https://pixelproof-license.getlaunchpod.workers.dev`

Do not create, rename, delete, or repoint these resources during routine
verification. Do not use production D1 or the production webhook secret for
local tests.

## Pages deployment

From the repository root:

```bash
CLOUDFLARE_WAMOJO_API_TOKEN=... ./scripts/deploy-pages.sh
```

Bind the token through the shell environment or the tool environment; never
put it in a file or command transcript.

After deployment, the script's asset checks must pass for every listed shell
asset and model. The checks include the model responses and their CORS headers.
Do not claim a deployment is good if an asset or model check fails.

The background-removal model mirror is configured in `config.js`:

```text
https://pub-a8d1cffdfd404e2da5d08f1a0f266934.r2.dev
```

The custom domain used by the app must be allowed in the R2 model CORS
configuration. At minimum, verify requests from:

```text
https://pixelproof.pages.dev
```

If the custom Pages domain is omitted from R2 CORS, background removal can
fail while ordinary image tools continue to work.

## Firefox checks

Playwright Firefox is already available from the shared image-test install:

```bash
node path/to/firefox-check.js
```

Use the Playwright package under `/home/ubuntu/imgtest/node_modules` when
working from the repository environment. The minimum browser probe should
cover:

- PNG, JPEG, WebP, and AVIF encoding behavior.
- Module workers, `OffscreenCanvas`, and `createImageBitmap`.
- Service worker and IndexedDB availability.
- File System Access availability.
- Compression, resize, crop, convert, target-size, image-to-PDF, comparison,
  ZIP download, and recovery after reload.

Firefox does not provide the File System Access API. The folder-save control
must be hidden and the UI must explain that ZIP is the supported fallback.

## WebKit/Safari checks

Install the WebKit dependencies:

```bash
cd /home/ubuntu/imgtest
npx playwright install-deps webkit
sudo apt-get install -y libx264-dev libwebkitgtk-6.0-4 libjavascriptcoregtk-6.0-1
```

The bundled WebKit build also needs its private libraries on the loader path.
Run WebKit checks with:

```bash
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
LD_LIBRARY_PATH=/home/ubuntu/.cache/ms-playwright/webkit-2336/minibrowser-gtk/sys/lib \
node path/to/webkit-check.js
```

The exact WebKit revision may change when Playwright is upgraded; update the
`webkit-*/minibrowser-gtk/sys/lib` segment to match the installed revision.
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` only bypasses Playwright's
preflight check. It does not supply missing libraries, so launch failures
still need to be diagnosed with `ldd` and the distro packages.

At 390×844 with touch enabled, exercise:

- Landing comparison movement.
- Background-removal canvas selection.
- Face-blur region creation.
- PDF page-handle reorder.
- Slider controls and page scrolling.

Also repeat the Firefox core suite, including generated-blob downloads,
IndexedDB recovery after reload, service-worker behavior, and a large-image
resize. Treat Playwright WebKit touch injection as evidence of the touch
pointer path, not a substitute for a physical iPhone Safari check.

## Evidence standard

Record the browser, deployed URL, commit, exact status text, output artifact
validation, and any environment limitation. A browser feature that is
unsupported must be explained in the UI rather than allowed to fail
implicitly. Keep detailed evidence in `imgtest/adversarial-findings.md` and
keep its round index current.
