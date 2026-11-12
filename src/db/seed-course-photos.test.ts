import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import { demoIllustration } from "@/content/demo-illustrations";
import { DEMO_COURSE_PHOTOS } from "./seed-course-photos";

describe("the demo’s activity illustrations", () => {
  it("covers every course with a bundled, explicitly marked demo illustration", () => {
    expect(Object.keys(DEMO_COURSE_PHOTOS).sort()).toEqual(
      COURSE_TEMPLATES.map((t) => t.slug).sort(),
    );
    for (const scene of Object.values(DEMO_COURSE_PHOTOS)) {
      const image = demoIllustration(scene);
      expect(image.alt).toContain("Generated demo illustration:");
      expect(existsSync(path.join(process.cwd(), "public", image.url))).toBe(true);
    }
  });

  it("shows dry oxygen training in a classroom and beginner training in confined water", () => {
    expect(DEMO_COURSE_PHOTOS["emergency-oxygen-provider"]).toBe("oxygen");
    expect(DEMO_COURSE_PHOTOS["ssi-react-right"]).toBe("oxygen");
    expect(DEMO_COURSE_PHOTOS["discover-scuba-diving"]).toBe("student");
    expect(DEMO_COURSE_PHOTOS["open-water-diver"]).toBe("student");
    expect(DEMO_COURSE_PHOTOS["boat-diver"]).toBe("boat");
  });
});
