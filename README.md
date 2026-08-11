# PixelProof

Browser-local image toolkit. Every image operation runs in the visitor's browser —
files are never uploaded and no server-side image processing exists.

Static site intended for Cloudflare Pages. Cross-origin isolation is enabled via
`_headers` so WebAssembly can use threads.
