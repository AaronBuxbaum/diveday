import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { losslessRecapPhoto, RECAP_PHOTO_PATH } from "../../e2e/recap-photo-fixture";

it("preserves every decoded pixel and the dimensions of the real recap photo", async () => {
  const jpeg = await readFile(path.join(process.cwd(), "public", RECAP_PHOTO_PATH));
  const png = await losslessRecapPhoto(jpeg);
  const original = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const result = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  expect(result.info).toMatchObject({
    width: original.info.width,
    height: original.info.height,
    channels: original.info.channels,
  });
  expect(result.data.equals(original.data)).toBe(true);
});
