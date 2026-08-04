import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { allowSvgRasterization } from "./og-rasterizer";

/**
 * The regression this module exists for, reproduced against real sharp rather
 * than a mock — a mock would only assert that we call `unblock`, not that
 * calling it restores the behaviour the OG cards actually need.
 *
 * `blockLikeNextImageOptimizer` is copied verbatim from
 * `next/dist/server/image-optimizer.js`'s `getSharp()`. If a Next upgrade
 * changes that list, this test starts failing here — in a unit test naming the
 * cause — instead of as a severed socket on a metadata route in production.
 */
const TINY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
);

function blockLikeNextImageOptimizer(): void {
  sharp.block({ operation: ["VipsForeignLoad"] });
  sharp.unblock({
    operation: [
      "VipsForeignLoadHeif",
      "VipsForeignLoadJpeg",
      "VipsForeignLoadNsgif",
      "VipsForeignLoadPng",
      "VipsForeignLoadTiff",
      "VipsForeignLoadWebp",
    ],
  });
}

// libvips block state is process-global, so leaving SVG blocked would leak into
// whatever test file vitest runs next in this worker.
afterEach(async () => {
  await allowSvgRasterization();
});

describe("allowSvgRasterization", () => {
  it("restores SVG rasterization after the image optimizer has blocked it", async () => {
    blockLikeNextImageOptimizer();
    await expect(sharp(TINY_SVG).png().toBuffer()).rejects.toThrow(/unsupported image format/);

    await allowSvgRasterization();

    const png = await sharp(TINY_SVG).png().toBuffer();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("leaves raster formats alone — they were never the problem", async () => {
    const red = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    blockLikeNextImageOptimizer();
    await allowSvgRasterization();

    expect((await sharp(red).png().toBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });

  it("is safe to call on every request", async () => {
    blockLikeNextImageOptimizer();
    await allowSvgRasterization();
    await allowSvgRasterization();
    await allowSvgRasterization();

    await expect(sharp(TINY_SVG).png().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });

  it("still works when the optimizer blocks AFTER a card has already rendered", async () => {
    // The ordering a once-per-process guard gets wrong, and the reason this
    // function is not memoized: a card renders first, then any page with an
    // optimized image initializes Next's optimizer, which blocks libvips again.
    // Reproduced end to end against a real server before being written down.
    await allowSvgRasterization();
    await expect(sharp(TINY_SVG).png().toBuffer()).resolves.toBeInstanceOf(Buffer);

    blockLikeNextImageOptimizer();

    await allowSvgRasterization();
    await expect(sharp(TINY_SVG).png().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });

  it("does not resurrect the loaders the optimizer blocks for other reasons", async () => {
    // Only SVG is asked for. A blanket `unblock({ operation: ["VipsForeignLoad"] })`
    // would hand back every exotic loader (PDF, and the rest of libvips'
    // untrusted set) — a far wider surface than the OG cards need.
    blockLikeNextImageOptimizer();
    await allowSvgRasterization();

    const notAnImage = Buffer.from("%PDF-1.4\n%not really a pdf\n");
    await expect(sharp(notAnImage).png().toBuffer()).rejects.toThrow(/unsupported image format/);
  });
});
