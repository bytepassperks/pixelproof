# PixelProof

PixelProof is a browser-local image workbench. Image files are decoded and
processed in the browser; the licensing Worker does not receive image data.
The static app is designed for Cloudflare Pages and uses cross-origin
isolation so future threaded browser inference remains available.

The workbench includes photo adjustments, meme captions, assisted manual face
blur, favicon and app-icon sets, social presets, bulk naming, palette
extraction, compression comparison, saved local presets, web exports, and
prompted background removal. Face blur intentionally requires box review and
explicit confirmation before export; it does not claim automatic detection.
Target-size compression searches quality independently per image and reports
the achieved bytes and quality. The Metadata tool reads EXIF locally, calls
out GPS coordinates, and can strip all metadata or preserve copyright and
orientation in JPEG output. Folder inputs retain safe relative paths in ZIP
exports, and named saved settings can be exported/imported as JSON pipeline
files. The app shell is installable and cacheable for offline workbench use;
first-use model downloads still need a network connection.
HEIC/HEIF photos are accepted as input across the workbench. They are decoded
locally in a separately loaded worker using the unmodified LGPL libheif/libde265
WASM module, then enter the ordinary browser-local image pipeline; HEIC is not
encoded. Full attribution and licence text are available in
`THIRD_PARTY_NOTICES` and from the workbench's runtime dialog.

## Phase 3 architecture

- `index.html` is the marketing page; `app.html` is the workbench.
- `activate.html` stores a licence key in this browser and periodically
  validates it. Failed validation falls back to Free.
- `worker/` contains only Dodo checkout creation, Dodo webhook handling, and
  licence validation. It does not process images.
- `worker/migrations/0001_init.sql` creates the D1 licence tables.
- EfficientSAM encoder and decoder assets are mirrored in the separate R2
  bucket `pixelproof-models`. ViTMatte remains fetched from its pinned
  Hugging Face repository; an R2 copy is retained for future runtime
  integration.

## Worker environment

Set these values in the `pixelproof-license` Worker. Product IDs and payment
credentials are deliberately not committed:

```text
DODO_BASE_URL=https://live.dodopayments.com
DODO_BUSINESS_ID=...
DODO_API_KEY=...
DODO_WEBHOOK_SECRET=...
DODO_SOLO_PRODUCT_ID=...
DODO_STUDIO_PRODUCT_ID=...
PAGES_ORIGIN=https://pixelproof.pages.dev
```

The D1 database is `pixelproof-licenses` and the Worker is
`pixelproof-license`. Apply migrations and deploy with:

```bash
npx wrangler d1 migrations apply pixelproof-licenses --remote --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Set secrets with `wrangler secret put NAME --config worker/wrangler.toml`.
The client API URL is centralized in `config.js`.

Live endpoints:

- Pages: https://pixelproof.pages.dev
- Licence Worker: https://pixelproof-license.getlaunchpod.workers.dev
- EfficientSAM R2 mirror: https://pub-a8d1cffdfd404e2da5d08c1f0a266934.r2.dev

## Static deployment

```bash
./scripts/deploy-pages.sh
```

The script deploys the repository root and then runs
`scripts/check-pages-assets.sh` against the live Pages URL. The post-deploy
check fails if any expected HTML, JavaScript, CSS, or Worker asset is missing,
redirects to HTML unexpectedly, or is served with the wrong content type.
Override the destination when needed:

```bash
./scripts/deploy-pages.sh https://pixelproof.pages.dev
```

The `_headers` file is required in the deployed static directory:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Browser-local image toolkit. Every image operation runs in the visitor's browser —
image bytes are never uploaded and no server-side image processing exists. The app downloads its own code and, on first background-removal use, model files; checkout and licence validation carry no image data.

Static site intended for Cloudflare Pages. Cross-origin isolation is enabled via
`_headers` so WebAssembly can use threads.
