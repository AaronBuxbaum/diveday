import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import { DEMO_COURSE_PHOTOS } from "./seed-course-photos";

/**
 * **One photo per course, never the cover or a site's** (UX review
 * 2026-10-10, item 19): the demo used one Molasses Reef frame for the shop's
 * cover, two courses and the Molasses Reef site.
 */
describe("the demo's course photos", () => {
  it("gives every course template a photo", () => {
    const missing = COURSE_TEMPLATES.map((t) => t.slug).filter((s) => !DEMO_COURSE_PHOTOS[s]);
    expect(missing).toEqual([]);
  });

  it("uses no photo twice", () => {
    const photos = Object.values(DEMO_COURSE_PHOTOS);
    expect(new Set(photos).size).toBe(photos.length);
  });

  it("names only photos already bundled, so no new binary ships", () => {
    const missing = Object.values(DEMO_COURSE_PHOTOS).filter(
      (species) => !existsSync(path.join(process.cwd(), "public/marine-life", `${species}.jpg`)),
    );
    expect(missing).toEqual([]);
  });

  it("names no template that does not exist", () => {
    const known = new Set(COURSE_TEMPLATES.map((t) => t.slug));
    expect(Object.keys(DEMO_COURSE_PHOTOS).filter((slug) => !known.has(slug))).toEqual([]);
  });
});
