import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const normalize = (text: string) => text.replace(/\s/gu, "").toLowerCase();
const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
export const decode = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]);

/** English seeded rota: assert actual paper ink, including repeated context and warnings. */
export async function assertCrewPdfPixels(
  pdf: string,
  requiredContext: string[],
  directory: string,
) {
  await mkdir(directory, { recursive: true });
  const run = (binary: string, args: string[]) => {
    try {
      return execFileSync(binary, args, { timeout: 30_000, encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Crew PDF regression needs Poppler (pdftoppm and pdftotext). Install poppler-utils on Linux or poppler on macOS. ${String(error)}`,
      );
    }
  };
  run("pdftoppm", ["-png", "-scale-to", "1500", pdf, path.join(directory, "page")]);
  const xml = run("pdftotext", ["-bbox", pdf, "-"]);
  const pages = [...xml.matchAll(/<page width="([\d.]+)" height="[\d.]+">([\s\S]*?)<\/page>/g)];
  const images = (await readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort();
  if (pages.length < 2 || pages.length !== images.length) {
    throw new Error(
      `Crew fixture must span multiple rendered sheets; PDF has ${pages.length} text pages and ${images.length} images`,
    );
  }
  for (const [index, page] of pages.entries()) {
    const words = [
      ...page[2].matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g,
      ),
    ];
    const text = normalize(words.map((word) => decode(word[5])).join(""));
    for (const required of [...requiredContext, "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) {
      if (!text.includes(normalize(required)))
        throw new Error(`Sheet ${index + 1} lacks ${required}`);
    }
    const image = await sharp(await readFile(path.join(directory, images[index])))
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = image.info.width / Number(page[1]);
    for (const word of words) {
      if (!/[\p{L}\p{N}]/u.test(decode(word[5]))) continue;
      const [left, top, right, bottom] = word
        .slice(1, 5)
        .map((value) => Math.floor(Number(value) * scale));
      let ink = 0;
      for (let y = Math.max(0, top); y <= Math.min(image.info.height - 1, bottom); y++) {
        for (let x = Math.max(0, left); x <= Math.min(image.info.width - 1, right); x++) {
          if (image.data[y * image.info.width + x] < 160) ink++;
        }
      }
      if (ink < 2)
        throw new Error(`Sheet ${index + 1}: extractable but invisible word ${decode(word[5])}`);
    }
  }
  return pages.length;
}
