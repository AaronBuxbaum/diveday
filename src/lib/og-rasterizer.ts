/**
 * Keeps libvips willing to rasterize SVG, which is what every OG card depends
 * on and what Next silently takes away.
 *
 * `@vercel/og` (bundled into `next/og`) renders a card by having satori emit
 * SVG and then rasterizing it to PNG. It prefers sharp for that step and falls
 * back to its bundled resvg WASM only when `import("sharp")` fails — and sharp
 * resolves here, because the upload pipeline depends on it
 * (`src/lib/storage/process-image.ts`).
 *
 * Next's image optimizer, on its first use in a process, does this
 * (`next/dist/server/image-optimizer.js`, `getSharp()`):
 *
 *     _sharp.block({ operation: ["VipsForeignLoad"] })
 *     _sharp.unblock({ operation: [
 *       "VipsForeignLoadHeif", "VipsForeignLoadJpeg", "VipsForeignLoadNsgif",
 *       "VipsForeignLoadPng",  "VipsForeignLoadTiff", "VipsForeignLoadWebp" ] })
 *
 * Every loader off, raster formats back on, SVG deliberately not among them.
 * That is **process-global libvips state**, not per-call — so from the first
 * `next/image` optimization onward, every OG card in that process fails.
 *
 * The failure is vicious to diagnose, which is why this comment is long. The
 * throw happens *inside the response stream*, after the 200 and its headers are
 * already on the wire, so there is no error page left to render and the socket
 * is simply destroyed. The client sees a bare `socket hang up`. The server logs
 * `failed to pipe response` caused by sharp's `Input buffer contains
 * unsupported image format` — which reads like a corrupt image and sent this
 * investigation chasing librsvg installs, sharp variants, fonts, and Cache
 * Components before the real cause. Note too that `sharp.format.svg.input`
 * keeps reporting `true` after the block: the capability table is built at
 * module init and never revised, so it actively lies about this.
 *
 * It is also order-dependent, hence intermittent: a process that has not yet
 * optimized an image renders cards fine, which is why it reproduced on some CI
 * shards and not others, and never locally.
 *
 * Calling `unblock` at startup would not work — Next's `block()` runs lazily on
 * first optimization and would simply overwrite it. So this runs on the render
 * path, immediately before the card is built.
 *
 * **This re-enables librsvg process-wide** (`sharp.block`/`unblock` have no
 * narrower scope), which is a deliberate, owner-approved trade: it restores the
 * loader Next turns off to keep librsvg away from untrusted bytes. The exposure
 * that buys back is `process-image.ts`, whose `sharp(input).metadata()` read
 * happens before its `DECODABLE_FORMATS` allowlist rejects SVG — so an uploaded
 * SVG's header is parsed by librsvg even though the file is then refused. See
 * ADR 20260804-og-svg-rasterizer for the alternatives weighed.
 */

/**
 * Re-enables libvips' SVG loader for this process.
 *
 * **Deliberately not memoized**, and this is load-bearing. Next's `block()`
 * runs on the *first image optimization*, which can happen at any point in a
 * process's life — including after an OG card has already rendered. A
 * once-per-process guard therefore fails in the most ordinary sequence there
 * is: card renders (unblock, guard set) → someone loads a page with an
 * optimized image (Next blocks) → next card returns early and renders nothing.
 * That ordering was reproduced end to end before this comment was written, so
 * treat the repeated call as required, not as a missed optimization. It costs
 * one native no-op call per card.
 *
 * Never throws: a card that cannot rasterize is a broken preview, but an
 * exception raised here — before the `ImageResponse` exists — would turn a
 * metadata route into a 500 on a page that is otherwise fine.
 */
export async function allowSvgRasterization(): Promise<void> {
  try {
    const sharp = (await import("sharp")).default;
    sharp.unblock({ operation: ["VipsForeignLoadSvg"] });
  } catch {
    // sharp absent or the API moved: `@vercel/og` then either uses its bundled
    // resvg WASM (no libvips involved, nothing to unblock) or fails on its own
    // terms. Either way there is nothing useful to do from here.
  }
}
