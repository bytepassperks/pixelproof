export const PRODUCT = Object.freeze({
  brand: 'PixelProof',
  tagline: 'Serious image work. Private by default.',
  version: '1.0.0',
  maxPixels: 64_000_000,
  maxBatchFiles: 100,
  concurrency: 2,
  webExports: [
    {name: 'WordPress hero', width: 1920, height: 1080, suffix: 'hero'},
    {name: 'WordPress card', width: 1200, height: 800, suffix: 'card'},
    {name: 'WordPress thumbnail', width: 768, height: 512, suffix: 'thumbnail'},
    {name: 'Shopify product', width: 2048, height: 2048, suffix: 'shopify-product'},
    {name: 'Shopify collection', width: 1200, height: 1200, suffix: 'shopify-collection'},
  ],
});

export const TIERS = Object.freeze({
  current: 'unlimited',
  // Phase 3 entitlement gates belong here; tools must not own billing logic.
  limits: {maxFiles: Infinity, maxPixels: PRODUCT.maxPixels},
});

export const MIME = Object.freeze({
  jpeg: {mime: 'image/jpeg', ext: 'jpg', label: 'JPEG'},
  png: {mime: 'image/png', ext: 'png', label: 'PNG'},
  webp: {mime: 'image/webp', ext: 'webp', label: 'WebP'},
});
