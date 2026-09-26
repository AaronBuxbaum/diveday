import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const SKELETON = readFileSync(join(import.meta.dirname, "loading.tsx"), "utf8");

/**
 * **One rhythm between the page's sections** (pixel-craft class 4). The two
 * cards stood 24px apart under `mt-8 space-y-6`, and the step-up card and the
 * notice hung `mt-6` margins of their own, where Team and WhatsApp put 40px
 * between sections: one `space-y-10` on the wrapper, never a margin on a
 * section (docs/design/forms-and-controls.md; K-521). A notice is the shared
 * banner above the sections, with its own `mb-6`, as Team's is.
 */
describe("the security page's section rhythm", () => {
  it("stacks every section in one space-y-10", () => {
    const wrapper = SOURCE.indexOf('<div className="space-y-10">');
    expect(wrapper, "the page has a space-y-10 wrapper").toBeGreaterThan(-1);
    const body = SOURCE.slice(wrapper);
    for (const heading of ["stepUpHeading", "twoFactorHeading", "sessionsHeading"]) {
      expect(body, `${heading}'s card is inside the wrapper`).toContain(heading);
    }
    expect(SOURCE).not.toContain("space-y-6");
  });

  it("hangs no margin of its own on any section or on the notice", () => {
    const cards = SOURCE.match(/<SectionCard\b[^>]*>/g) ?? [];
    expect(cards.length, "step-up, two-factor and sessions").toBe(3);
    for (const card of cards) expect(card).not.toMatch(/\bmt-/);
    expect(SOURCE).toContain("<StaffNoticeBanner");
    expect(SOURCE).not.toContain('<div className="mt-6">');
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the page arrives", () => {
    expect(SKELETON).toContain('<div className="space-y-10">');
    expect(SKELETON).not.toMatch(/\bmt-[68]\b/);
  });
});
