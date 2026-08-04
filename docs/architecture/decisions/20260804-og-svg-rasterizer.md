# 20260804-og-svg-rasterizer — OG cards re-enable libvips' SVG loader

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Every `ImageResponse` surface — the five OpenGraph cards plus `icon.tsx` and
`apple-icon.tsx` — renders the same way: satori emits SVG, and `@vercel/og`
(bundled into `next/og`) rasterizes that SVG to PNG. It prefers **sharp** for
that step and falls back to its bundled resvg WASM only when `import("sharp")`
fails. Sharp resolves in this app, because the upload pipeline needs it
(`src/lib/storage/process-image.ts`), so the sharp path is always the one taken.

Next's image optimizer, the first time it runs in a process
(`next/dist/server/image-optimizer.js`, `getSharp()`), does this:

```js
_sharp.block({ operation: ["VipsForeignLoad"] })
_sharp.unblock({ operation: [
  "VipsForeignLoadHeif", "VipsForeignLoadJpeg", "VipsForeignLoadNsgif",
  "VipsForeignLoadPng",  "VipsForeignLoadTiff", "VipsForeignLoadWebp" ] })
```

Every loader off; raster formats back on; **SVG deliberately not among them**,
because librsvg parsing untrusted bytes is a known attack surface. That call
mutates **process-global libvips state**. So from the first `next/image`
optimization onward, no OG card in that process can be rasterized.

The failure is unusually hostile to diagnose:

- The throw happens *inside the response stream*, after the 200 and its headers
  are already on the wire. No error page can be rendered, so the socket is
  destroyed and the client sees only `socket hang up`.
- The server-side cause is sharp's `Input buffer contains unsupported image
  format`, which reads like a corrupt image — it sent the investigation through
  librsvg installs, sharp variants, musl/glibc prebuilts, fonts, and Cache
  Components before the real cause.
- `sharp.format.svg.input` still reports `true` after the block. The capability
  table is built at module init and never revised, so it actively misreports.
- It is order-dependent, therefore intermittent: a process that has not yet
  optimized an image renders cards fine. It reproduced on some CI shards and not
  others, and never locally.

It also explains the timing: this route shipped working, and only started
failing when sharp was added for the upload pipeline (`835b2b0`). Before that,
`@vercel/og` used resvg WASM, which libvips blocking cannot touch.

`images.dangerouslyAllowSVG` does not help — it gates whether `next/image` will
*serve* an upstream SVG, and has no bearing on the unconditional `block()` in
`getSharp()`.

## Decision

Call `sharp.unblock({ operation: ["VipsForeignLoadSvg"] })` on the render path of
every `ImageResponse` surface, via `allowSvgRasterization()` in
`src/lib/og-rasterizer.ts`.

On the render path, not at startup: Next's `block()` runs lazily on first
optimization and would simply overwrite an earlier unblock.

Only `VipsForeignLoadSvg`. Unblocking the `VipsForeignLoad` parent would hand
back every loader the optimizer turned off, including PDF and the rest of
libvips' untrusted set — far wider than the cards need. A test asserts that
narrowness rather than trusting the argument.

## Consequences

This re-enables librsvg **process-wide**; `sharp.block`/`unblock` offer no
narrower scope. The concrete exposure is `process-image.ts`, whose
`sharp(input).metadata()` read happens *before* its `DECODABLE_FORMATS`
allowlist (`jpeg`/`png`/`webp`/`heif`) rejects SVG. An uploaded SVG is still
refused, but librsvg parses its header first. That was weighed and accepted by
the owner as the cost of working link previews.

Because the exposure is accepted rather than eliminated, a `security-reviewer`
pass is warranted on any future change that widens what `process-image.ts`
accepts, or that adds a new caller feeding user-supplied bytes to sharp.

`src/lib/og-rasterizer.test.ts` reproduces the optimizer's exact block sequence
against real sharp. If a Next upgrade changes that list, it fails there — in a
unit test that names the cause — rather than as a severed socket in production.

## Alternatives considered

- **Pre-sniff magic bytes in `process-image.ts`** before handing bytes to sharp,
  keeping the unblock but denying librsvg any untrusted input. This removes
  nearly all of the exposure above and remains the natural follow-up if the
  upload path is ever hardened further.
- **Render the cards with satori + resvg directly**, never touching libvips.
  Immune to future libvips policy changes, but adds a runtime dependency and
  reimplements what `next/og` already does.
- **`images.dangerouslyAllowSVG`** — does not apply; see Context.
