# PixelProof

PixelProof is a browser-local image workbench. Image files are decoded and
processed in the browser; the licensing Worker does not receive image data.
The static app is designed for Cloudflare Pages and uses cross-origin
isolation so future threaded browser inference remains available.

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
npx wrangler pages deploy <static-directory> --project-name pixelproof --branch main
```

The `_headers` file is required in the deployed static directory:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Browser-local image toolkit. Every image operation runs in the visitor's browser —
files are never uploaded and no server-side image processing exists.

Static site intended for Cloudflare Pages. Cross-origin isolation is enabled via
`_headers` so WebAssembly can use threads.
