import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import { SEED_COURSE_ILLUSTRATIONS } from "./course-illustrations";
import { OPEN_WATER_GALLERY } from "./course-photos";

describe("the demo's course illustrations", () => {
  it("has a specific illustration for every template and the extra SSI course", () => {
    expect(Object.keys(SEED_COURSE_ILLUSTRATIONS).sort()).toEqual(
      [...COURSE_TEMPLATES.map((template) => template.slug), "ssi-nitrox-40"].sort(),
    );
    const images = Object.values(SEED_COURSE_ILLUSTRATIONS);
    expect(new Set(images.map((image) => image.url)).size).toBe(images.length);
    expect(images.every((image) => image.alt.startsWith("Illustration: "))).toBe(true);
  });

  it("fills the Open Water gallery with distinct bundled illustrations", () => {
    expect(OPEN_WATER_GALLERY).toHaveLength(8);
    expect(new Set(OPEN_WATER_GALLERY.map((photo) => photo.url)).size).toBe(8);
    expect(OPEN_WATER_GALLERY.every((photo) => existsSync(`public${photo.url}`))).toBe(true);
    expect(OPEN_WATER_GALLERY.every((photo) => photo.alt.startsWith("Illustration: "))).toBe(true);
  });
});
