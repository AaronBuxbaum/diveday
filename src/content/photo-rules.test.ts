import { describe, expect, it } from "vitest";
import {
  FOLDERS,
  irrelevantWord,
  licenceOk,
  measure,
  plain,
  QUALITY_FLOOR,
  qualityProblem,
  refusal,
} from "./photo-rules";

const good = {
  title: "File:Blue tang Bonaire.jpg",
  licence: "CC BY-SA 4.0",
  width: 3000,
  height: 2000,
  categories: ["Acanthurus coeruleus"],
};

describe("licenceOk", () => {
  it("allows the free families and refuses NC, ND and fair use", () => {
    for (const ok of ["Public domain", "CC0", "CC BY 2.0", "CC BY-SA 4.0", "No restrictions"]) {
      expect(licenceOk(ok)).toBe(true);
    }
    for (const no of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "Fair use", "", null]) {
      expect(licenceOk(no)).toBe(false);
    }
  });
});

describe("refusal", () => {
  it("passes a large, freely licensed photograph of the subject", () => {
    expect(refusal(good, "marine-life")).toBeNull();
  });

  it("refuses an original smaller than the folder's bound, so nothing is upscaled", () => {
    expect(refusal({ ...good, width: 205, height: 294 }, "dive-sites")).toBe(
      "source 294px, below 1024px",
    );
    expect(refusal({ ...good, width: 800, height: 600 }, "marine-life")).toBeNull();
    expect(FOLDERS["dive-sites"].minSource).toBe(FOLDERS["dive-sites"].bound);
  });

  it("refuses by licence before anything else", () => {
    expect(refusal({ ...good, licence: "CC BY-NC 2.0", width: 10 }, "marine-life")).toBe(
      "licence CC BY-NC 2.0",
    );
  });

  it("refuses maps, specimens, catches and aquarium tanks by their description", () => {
    expect(refusal({ ...good, title: "File:Range map of Acanthurus.png" }, "marine-life")).toBe(
      "described as “map”",
    );
    expect(refusal({ ...good, categories: ["Fish in the Georgia Aquarium"] }, "marine-life")).toBe(
      "described as “aquarium”",
    );
    expect(irrelevantWord("File:Grouper_caught_off_Key_West.jpg")).toBe("caught");
    expect(irrelevantWord("File:Mapleleaf coral.jpg")).toBeNull();
  });

  it("refuses an unreadable picture once it has been measured", () => {
    expect(refusal(good, "marine-life", { highlights: 40, sharpness: 500 })).toBe(
      "too dark (highlights 40)",
    );
    expect(refusal(good, "marine-life", { highlights: 200, sharpness: 3 })).toBe(
      "too soft (sharpness 3.0)",
    );
  });
});

describe("measure", () => {
  it("scores a flat grey frame as soft and a checkerboard as sharp", () => {
    const size = 32;
    const flat = new Uint8Array(size * size).fill(128);
    const checker = new Uint8Array(size * size).map((_, index) =>
      ((index % size) + Math.floor(index / size)) % 2 ? 255 : 0,
    );
    expect(measure(flat, size, size).sharpness).toBe(0);
    expect(measure(checker, size, size).sharpness).toBeGreaterThan(QUALITY_FLOOR.sharpness);
  });

  it("reads a lit subject on black water by its highlights, not its mean", () => {
    const size = 40;
    const night = new Uint8Array(size * size).fill(5);
    night.fill(220, 0, size * 4); // a tenth of the frame lit
    expect(measure(night, size, size).highlights).toBe(220);
    expect(qualityProblem({ highlights: 220, sharpness: 100 })).toBeNull();
  });
});

describe("plain", () => {
  it("strips nested tags and decodes entities once", () => {
    expect(plain('<a href="x">Jane <scr<b>ipt>Doe</a>')).toBe("Jane ipt>Doe");
    expect(plain("A &amp;quot; B")).toBe("A &quot; B");
  });
});
