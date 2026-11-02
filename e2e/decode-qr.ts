import jsQR from "jsqr";
import sharp from "sharp";

const PNG_DATA_URL = "data:image/png;base64,";

/**
 * Decode a QR `<img src>` PNG data URL to the text it encodes, entirely in memory. The decoded
 * value is a bearer capability: callers must never log, attach, write or screenshot it, and each
 * keeps its own destination check. `label` only prefixes the failure messages ("lead QR", ...).
 */
export async function decodeQrDataUrl(src: string | null, label = "QR"): Promise<string> {
  if (!src?.startsWith(PNG_DATA_URL)) throw new Error(`${label} image missing`);
  const png = Buffer.from(src.slice(PNG_DATA_URL.length), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!decoded) throw new Error(`${label} could not be decoded`);
  return decoded.data;
}
