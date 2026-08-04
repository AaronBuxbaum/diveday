/**
 * TEMPORARY DIAGNOSTIC — delete once the recap OG-image failure is understood.
 *
 * `e2e/recap.spec.ts`'s "unfurl card reveals nothing for a bad token" fails on
 * CI and only on CI (3 runs for 3, across `main` and two PRs), with a
 * `socket hang up` on `GET /recap/<bad>/opengraph-image`. Server-side the
 * runner logs `failed to pipe response` whose cause is sharp's
 * `Input buffer contains unsupported image format`.
 *
 * The mechanism is known. `@vercel/og` (bundled into `next/og`) opportunistically
 * does `await import("sharp")` and, when that resolves, rasterizes satori's SVG
 * through sharp instead of its bundled resvg WASM:
 *
 *     if (sharp) pngBuffer = await sharp(new TextEncoder().encode(svg))…toBuffer();
 *     else       // resvg WASM fallback
 *
 * `sharp` became importable when it was added for the upload pipeline
 * (src/lib/storage/process-image.ts), which silently switched this route's
 * rasterizer. What is *not* known is which stage then fails on the runner, and
 * two hypotheses fit the same error text equally well:
 *
 *   A. sharp cannot decode SVG there — its libvips lacks librsvg.
 *   B. sharp is fine and satori handed it an empty/truncated SVG.
 *
 * Guessing between them means guessing at a fix, so this measures instead. It
 * runs the real path — the same `ImageResponse` the route builds — and reports
 * which stage breaks. `sharp.versions.rsvg` alone settles A: it is present
 * locally (2.62.90), where every stage passes.
 */

const result = {};

try {
  const sharp = (await import("sharp")).default;
  result.sharpResolved = true;
  // The discriminator for hypothesis A: no `rsvg` here means no SVG decoding.
  result.libvips = sharp.versions?.vips ?? null;
  result.rsvg = sharp.versions?.rsvg ?? "ABSENT";
  result.declaresSvgInput = Boolean(sharp.format?.svg?.input?.buffer);

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
  );
  try {
    const png = await sharp(svg).resize(20).png().toBuffer();
    result.sharpSvgToPng = `ok (${png.length} bytes)`;
  } catch (error) {
    result.sharpSvgToPng = `FAILED: ${error.message}`;
  }
} catch (error) {
  // If sharp is *not* importable on the runner, `@vercel/og` would be taking
  // its resvg path and neither hypothesis holds — that would be its own answer.
  result.sharpResolved = false;
  result.sharpImportError = error.message;
}

try {
  const [{ ImageResponse }, React] = await Promise.all([import("next/og.js"), import("react")]);
  const response = new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          width: "100%",
          height: "100%",
          fontSize: 56,
          background: "#071720",
          color: "#e9f3f4",
        },
      },
      "A dive recap",
    ),
    { width: 1200, height: 630 },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  const isPng = bytes.subarray(1, 4).toString() === "PNG";
  result.imageResponse = `ok (${bytes.length} bytes, png=${isPng})`;
} catch (error) {
  const cause = error?.cause ? ` | cause: ${error.cause.message ?? error.cause}` : "";
  result.imageResponse = `FAILED: ${error?.message}${cause}`;
}

console.log(JSON.stringify(result, null, 2));
