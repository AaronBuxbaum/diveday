import sharp, { type Metadata, type Sharp as SharpImage } from "sharp";

/**
 * ~40 megapixels — generous for any real photo (a 45MP pro camera RAW export
 * is an outlier this app never expects), tight enough to reject a small file
 * that *decodes* into an enormous bitmap before that decode ever happens
 * (CR-012's decompression-bomb case). Checked against `metadata()`'s declared
 * dimensions, which formats store in their header — reading it doesn't decode
 * the full image, so this gate is cheap even for a hostile file.
 */
const MAX_IMAGE_PIXELS = 40_000_000;

const OUTPUT_JPEG_QUALITY = 85;

/**
 * Formats `sharp` will actually decode for us. Matches
 * `ALLOWED_IMAGE_CONTENT_TYPES` (`limits.ts`) by intent, not by import — this
 * checks what the bytes *decoded as*, not what the caller claimed, so the two
 * lists are deliberately independent: a file must pass both the caller's
 * claimed content-type (cheap first gate in `storeImage`) and this real
 * decode (authoritative) to be accepted. Sharp's "heif" covers HEIC input
 * (the format any recent iPhone photo arrives in); this repo does not encode
 * back to HEIF; below both HEIC and JPEG/PNG/WebP converge to one JPEG output.
 */
const DECODABLE_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export type ProcessedImage = { ok: true; bytes: Buffer; contentType: "image/jpeg" } | { ok: false };

/**
 * The authoritative check the caller-supplied `contentType` ever only
 * pretended to be (CR-012): decode the actual bytes, reject anything that
 * isn't really one of our supported formats — a disguised file (any other
 * bytes wearing a `.jpg` name and an `image/jpeg` header) fails *here*, on
 * what it actually is, not on what it claims to be — reject a pixel count
 * large enough to be a decompression bomb before ever decoding the full
 * bitmap, then re-encode to JPEG. Re-encoding is what actually strips EXIF/
 * ICC/GPS metadata: sharp omits all of it from the output unless
 * `withMetadata()` is explicitly called, which nothing here does. `.rotate()`
 * with no arguments applies the EXIF orientation tag's *visual* rotation
 * before that tag is dropped, so a photo taken sideways doesn't end up
 * sideways once its metadata is gone.
 */
export async function processImage(bytes: ArrayBuffer | Buffer): Promise<ProcessedImage> {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let image: SharpImage;
  let metadata: Metadata;
  try {
    // The constructor itself can throw synchronously (e.g. an empty buffer),
    // not just the async metadata read — both need to fail closed the same way.
    image = sharp(input);
    metadata = await image.metadata();
  } catch {
    return { ok: false };
  }
  if (!metadata.format || !DECODABLE_FORMATS.has(metadata.format)) return { ok: false };
  if (!metadata.width || !metadata.height) return { ok: false };
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) return { ok: false };

  try {
    const reencoded = await image.rotate().jpeg({ quality: OUTPUT_JPEG_QUALITY }).toBuffer();
    return { ok: true, bytes: reencoded, contentType: "image/jpeg" };
  } catch {
    return { ok: false };
  }
}
