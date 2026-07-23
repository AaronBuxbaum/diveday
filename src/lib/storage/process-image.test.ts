import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processImage } from "./process-image";

async function realImage(
  format: "jpeg" | "png" | "webp",
  options: { width?: number; height?: number; withExif?: boolean } = {},
): Promise<Buffer> {
  const { width = 4, height = 4, withExif = false } = options;
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  });
  if (withExif) {
    // sharp's Exif type is `{ [tag: string]: string }` per IFD — every value,
    // including numeric ones like Orientation, must be a string.
    pipeline = pipeline.withExifMerge({
      IFD0: { Copyright: "diveday-test", GPSLatitude: "10,0,0", GPSLatitudeRef: "N" },
    });
  }
  return pipeline[format]().toBuffer();
}

describe("processImage (CR-012)", () => {
  it("rejects a disguised file even though the bytes are plausible-length", async () => {
    const disguised = Buffer.from(
      "this is not an image, just text pretending to be one".repeat(50),
    );
    expect(await processImage(disguised)).toEqual({ ok: false });
  });

  it("rejects a zero-byte or truncated/corrupt file", async () => {
    expect(await processImage(new ArrayBuffer(0))).toEqual({ ok: false });
    const real = await realImage("jpeg");
    const truncated = real.subarray(0, Math.floor(real.byteLength / 3));
    expect(await processImage(truncated)).toEqual({ ok: false });
  });

  it("rejects a decompression bomb — a small file whose declared dimensions are huge", async () => {
    // A solid-color fill compresses far better than a real photo at the same
    // dimensions: well under the app's 5 MB upload cap, yet it would decode
    // into an 81-megapixel bitmap (over MAX_IMAGE_PIXELS) if actually rendered.
    const bomb = await realImage("png", { width: 9000, height: 9000 });
    expect(bomb.byteLength).toBeLessThan(5 * 1024 * 1024);
    expect(await processImage(bomb)).toEqual({ ok: false });
  });

  it("accepts a JPEG, PNG, and WebP within bounds, always re-encoding to JPEG", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const input = await realImage(format, { width: 12, height: 8 });
      const result = await processImage(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.contentType).toBe("image/jpeg");
      const decoded = await sharp(result.bytes).metadata();
      expect(decoded.format).toBe("jpeg");
      expect(decoded.width).toBe(12);
      expect(decoded.height).toBe(8);
    }
  });

  it("strips EXIF/GPS metadata on re-encode instead of publishing it", async () => {
    const withExif = await realImage("jpeg", { withExif: true });
    const beforeMeta = await sharp(withExif).metadata();
    expect(beforeMeta.exif).toBeDefined();

    const result = await processImage(withExif);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterMeta = await sharp(result.bytes).metadata();
    expect(afterMeta.exif).toBeUndefined();
  });
});
