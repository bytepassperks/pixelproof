export const PRODUCT = Object.freeze({
  brand: 'PixelProof',
  tagline: 'Serious image work. Private by default.',
  version: '1.0.0',
  workerUrl: 'https://pixelproof-license.getlaunchpod.workers.dev',
  modelMirrorUrl: 'https://pub-a8d1cffdfd404e2da5d08c1f0a266934.r2.dev',
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
  current: 'free',
  free: Object.freeze({
    label: 'Free',
    price: 0,
    tasksPerDay: 10,
    maxFiles: 5,
    backgroundRemoval: false,
    clientUse: false,
  }),
  solo: Object.freeze({
    label: 'Lifetime Solo',
    price: 49,
    tasksPerDay: Infinity,
    maxFiles: 100,
    backgroundRemoval: true,
    clientUse: false,
  }),
  studio: Object.freeze({
    label: 'Lifetime Studio',
    price: 99,
    tasksPerDay: Infinity,
    maxFiles: 250,
    backgroundRemoval: true,
    clientUse: true,
  }),
  limits: {maxFiles: 5, maxPixels: PRODUCT.maxPixels},
});

export const MIME = Object.freeze({
  jpeg: {mime: 'image/jpeg', ext: 'jpg', label: 'JPEG'},
  png: {mime: 'image/png', ext: 'png', label: 'PNG'},
  webp: {mime: 'image/webp', ext: 'webp', label: 'WebP'},
});

export const PLATFORM_PROFILES = Object.freeze([
  {id: 'wordpress', name: 'WordPress image', width: 1920, height: 1080, mime: 'image/jpeg', mode: 'fit', source: 'https://wordpress.org/documentation/article/image-size-and-quality/', checked: '2026-08-11'},
  {id: 'etsy', name: 'Etsy listing image', width: 2000, height: 2000, mime: 'image/jpeg', mode: 'fit', source: 'https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop', checked: '2026-08-11'},
  {id: 'youtube', name: 'YouTube thumbnail', width: 1280, height: 720, mime: 'image/jpeg', mode: 'fit', source: 'https://support.google.com/youtube/answer/72431?hl=en', checked: '2026-08-11'},
  {id: 'linkedin', name: 'LinkedIn image', width: 1200, height: 627, mime: 'image/jpeg', mode: 'fit', source: 'https://www.linkedin.com/help/linkedin/answer/a566445', checked: '2026-08-11'},
  {id: 'shopify', name: 'Shopify product image', width: 2048, height: 2048, mime: 'image/jpeg', mode: 'fit', source: 'https://help.shopify.com/en/manual/products/product-media/product-media-types', checked: '2026-08-11'},
  {id: 'amazon', name: 'Amazon product image', width: 2000, height: 2000, mime: 'image/jpeg', mode: 'fit', source: 'https://sellercentral.amazon.com/help/hub/reference/G200164330', checked: '2026-08-11'},
  {id: 'apple-store', name: 'Apple App Store screenshot', width: 1320, height: 2868, mime: 'image/png', mode: 'fit', source: 'https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots', checked: '2026-08-11'},
  {id: 'google-play', name: 'Google Play store graphic', width: 1024, height: 500, mime: 'image/jpeg', mode: 'fit', source: 'https://support.google.com/googleplay/android-developer/answer/9866151', checked: '2026-08-11'},
]);
