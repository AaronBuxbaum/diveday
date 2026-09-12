#!/usr/bin/env tsx

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ImageResponse } from "next/og";
import { BubbleMark } from "@/app/_brand/mark";
import { allowSvgRasterization } from "@/lib/og-rasterizer";

/**
 * **Renders the committed brand icons. Run by hand when the mark changes,
 * never as part of the build.**
 *
 *     pnpm brand:icons
 *
 * The four PNGs this writes used to be `ImageResponse` metadata routes
 * (`src/app/icon.tsx`, `src/app/apple-icon.tsx`). Next attaches a metadata
 * module to *every page entry*, so importing `next/og` there dragged 3.07 MiB
 * of satori, font and WASM into every closure in the app, including the ones
 * that render no image at all (issues #1355, #1361). It is not the whole fix:
 * `src/app/opengraph-image.tsx` is a metadata module too and still does this,
 * which is issue #1709. The icons are static anyway — they are two fewer
 * request-time rasterizers and two fewer function closures, and the mark does
 * not change between deploys.
 *
 * The mark is still drawn from `BubbleMark` by the same satori + sharp pipeline
 * that drew it at request time, so there is one source of truth for the artwork
 * and re-running this reproduces the bytes for a pinned `next` and `sharp`.
 *
 * **Nothing reports drift.** A change to `BubbleMark` or `_brand/colors.ts` no
 * longer reaches the favicon until somebody runs this, and no guard compares
 * the committed bytes against a fresh render. Edit the mark, run this, commit
 * the PNGs in the same change.
 *
 * `src/app/pwa-icon-maskable/route.tsx` stays a request-time route: it is its
 * own function closure, was never attached to a page entry, and keeps a live
 * renderer beside these stills.
 */
const ROOT = process.cwd();

const icons = [
  // Next's static metadata convention: a `<link rel="icon">` for the tab.
  { size: 32, file: "src/app/icon.png" },
  // Next's static metadata convention: `<link rel="apple-touch-icon">`.
  { size: 180, file: "src/app/apple-icon.png" },
  // These two are in `public/` and not `src/app/icon1.png`, because the
  // numbered-icon convention would turn each into another `<link rel="icon">`
  // a browser may pick for a tab. They exist only for Chrome's installability
  // criteria (issue #794), which read the manifest's `icons` array.
  { size: 192, file: "public/icon-192.png" },
  { size: 512, file: "public/icon-512.png" },
];

async function main() {
  // Same libvips/SVG hazard as the OG cards, despite this being pure shapes:
  // satori still emits SVG and @vercel/og still rasterizes it through sharp.
  // See src/lib/og-rasterizer.ts and ADR 20260804-og-svg-rasterizer.
  await allowSvgRasterization();

  for (const { size, file } of icons) {
    const png = await new ImageResponse(<BubbleMark size={size} />, {
      width: size,
      height: size,
    }).arrayBuffer();
    const target = path.join(ROOT, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(png));
    console.log(`brand:icons: wrote ${file} (${size}x${size}, ${png.byteLength} bytes)`);
  }
}

// Not top-level await: `tsx` transforms this as CJS (package.json has no
// `"type": "module"`) and esbuild refuses it there.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
