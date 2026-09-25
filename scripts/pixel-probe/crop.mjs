import sharp from "sharp";

/**
 * **Crops a person can judge a pixel from.**
 *
 * A whole-page capture viewed whole is scaled down until a 4px offset
 * disappears — the 390px manifest is 5,539px tall — which is how agents kept
 * signing off detail they could not see. So every flag gets its own crop: the
 * element plus 16px, upscaled nearest-neighbour (×3 up to 160px, ×2 up to
 * 400px) so each CSS pixel is a crisp block, with guide lines at the measured
 * edges. Every image stays within 1,568px on its long edge and 1.15
 * megapixels, the size an image is shown at without being scaled down again.
 *
 * `sharp` is already a dependency (the image pipeline in
 * `src/lib/storage/process-image.ts`); this adds no new one.
 */

export const CROP_MARGIN = 16;
export const MAX_EDGE = 1568;
export const MAX_PIXELS = 1_150_000;

const COLOURS = {
  magenta: [236, 0, 140],
  cyan: [0, 170, 230],
  orange: [255, 128, 0],
  green: [0, 170, 60],
};

/** The upscale for a region of this size, shrunk until it fits the limits. */
export function cropScale(width, height) {
  const long = Math.max(width, height);
  let scale = long <= 160 ? 3 : long <= 400 ? 2 : 1;
  while (
    scale > 1 &&
    (width * scale > MAX_EDGE ||
      height * scale > MAX_EDGE ||
      width * height * scale * scale > MAX_PIXELS)
  ) {
    scale -= 1;
  }
  return scale;
}

/**
 * The region a crop shows: the flagged box plus the margin, clamped to the
 * image, and cut down (keeping the box's top-left in view) when even ×1 would
 * be over the limits.
 */
export function cropRegion(rect, imageWidth, imageHeight, margin = CROP_MARGIN) {
  const [x, y, w, h] = rect;
  let x1 = Math.max(0, Math.floor(x - margin));
  let y1 = Math.max(0, Math.floor(y - margin));
  let x2 = Math.min(imageWidth, Math.ceil(x + w + margin));
  let y2 = Math.min(imageHeight, Math.ceil(y + h + margin));
  if (x2 - x1 > MAX_EDGE) x2 = x1 + MAX_EDGE;
  if (y2 - y1 > MAX_EDGE) y2 = y1 + MAX_EDGE;
  const maxHeight = Math.floor(MAX_PIXELS / Math.max(1, x2 - x1));
  if (y2 - y1 > maxHeight) y2 = y1 + maxHeight;
  if (x2 <= x1 || y2 <= y1) return null;
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Decode a PNG (path or buffer) to raw RGBA once, so many crops can share it. */
export async function loadRaw(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function blend(pixels, index, colour, alpha = 0.9) {
  pixels[index] = Math.round(pixels[index] * (1 - alpha) + colour[0] * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * (1 - alpha) + colour[1] * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * (1 - alpha) + colour[2] * alpha);
  pixels[index + 3] = 255;
}

/**
 * Cut `region` out of `raw`, scale it nearest-neighbour, and outline each
 * guide box. Pure over buffers, so it is testable without a browser.
 */
export function renderCrop(raw, region, guides = [], scale = cropScale(region.w, region.h)) {
  const outWidth = region.w * scale;
  const outHeight = region.h * scale;
  const pixels = Buffer.alloc(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = region.y + Math.floor(y / scale);
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = region.x + Math.floor(x / scale);
      const from = (sourceY * raw.width + sourceX) * 4;
      const to = (y * outWidth + x) * 4;
      pixels[to] = raw.data[from];
      pixels[to + 1] = raw.data[from + 1];
      pixels[to + 2] = raw.data[from + 2];
      pixels[to + 3] = 255;
    }
  }
  for (const { box, color } of guides) {
    const colour = COLOURS[color] || COLOURS.magenta;
    const [gx, gy, gw, gh] = box;
    // Edges land on the boundary between CSS pixels: a box's left edge is the
    // first scaled column of its first pixel.
    const x1 = Math.round((gx - region.x) * scale);
    const y1 = Math.round((gy - region.y) * scale);
    const x2 = Math.round((gx + gw - region.x) * scale) - 1;
    const y2 = Math.round((gy + gh - region.y) * scale) - 1;
    const hLine = (y, from, to) => {
      if (y < 0 || y >= outHeight) return;
      for (let x = Math.max(0, from); x <= Math.min(outWidth - 1, to); x += 1) {
        blend(pixels, (y * outWidth + x) * 4, colour);
      }
    };
    const vLine = (x, from, to) => {
      if (x < 0 || x >= outWidth) return;
      for (let y = Math.max(0, from); y <= Math.min(outHeight - 1, to); y += 1) {
        blend(pixels, (y * outWidth + x) * 4, colour);
      }
    };
    if (gh < 0.5) hLine(y1, x1, x2);
    else if (gw < 0.5) vLine(x1, y1, y2);
    else {
      hLine(y1, x1, x2);
      hLine(y2, x1, x2);
      vLine(x1, y1, y2);
      vLine(x2, y1, y2);
    }
  }
  return { data: pixels, width: outWidth, height: outHeight };
}

/** Write a rendered crop as PNG. */
export async function writePng(image, path) {
  await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png()
    .toFile(path);
}

/** Crop a flag out of a decoded full-page capture and write it. Returns the region, or null. */
export async function writeCrop(raw, rect, guides, path, margin = CROP_MARGIN) {
  const region = cropRegion(rect, raw.width, raw.height, margin);
  if (!region) return null;
  await writePng(renderCrop(raw, region, guides), path);
  return region;
}

/**
 * Upscale a screenshot the page already cropped (a forced hover or focus
 * state, taken with `clip`) and outline guides given in document coordinates.
 */
export async function writeClipShot(buffer, clip, guides, path) {
  const raw = await loadRaw(buffer);
  const region = { x: 0, y: 0, w: raw.width, h: raw.height };
  const shifted = guides.map(({ box, color }) => ({
    box: [box[0] - clip.x, box[1] - clip.y, box[2], box[3]],
    color,
  }));
  await writePng(renderCrop(raw, region, shifted), path);
}
