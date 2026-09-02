// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { REEF_DRAWINGS, SITE_MARKS, siteMarkGroundFor } from "@/lib/site-mark";
import { SITE_MARK_GROUNDS, SITE_MARK_MIN_PX, SITE_MARK_SIZES, SiteMark } from "./SiteMark";

afterEach(cleanup);

/**
 * The illustration rule (ADR 20260901-diveday-reimagined, decision 1): one
 * hand, at most one coral detail per drawing and only where the caller spent
 * it, never below 20px, never on a safety or payment surface (that walk lives
 * in `illustration.test.ts`), never as a status.
 */
describe("SiteMark", () => {
  it("draws every code the hand carries, decoratively, with one coral detail each by default", () => {
    for (const mark of REEF_DRAWINGS) {
      const { container, unmount } = render(<SiteMark mark={mark} />);
      const tile = container.querySelector(`[data-site-mark="${mark}"]`);
      expect(tile?.getAttribute("aria-hidden")).toBe("true");
      const svg = tile?.querySelector("svg");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("stroke-width")).toBe("1.7");
      expect(svg?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      const coral = svg?.querySelectorAll('[fill="var(--accent)"]') ?? [];
      expect(coral.length, `${mark} carries one coral detail`).toBe(1);
      unmount();
    }
  });

  it("draws in the line alone when the surface has spent its coral elsewhere", () => {
    // The budget is one creature's detail per surface: a spine of three boats
    // or a board of twenty draws every mark but one without it, and the
    // drawing that gives its coral up loses nothing else — the shape is the
    // same, filled from the ground.
    for (const mark of REEF_DRAWINGS) {
      const { container, unmount } = render(<SiteMark mark={mark} coral={false} />);
      const svg = container.querySelector("svg");
      expect(svg?.querySelectorAll('[fill="var(--accent)"]').length, mark).toBe(0);
      expect(svg?.innerHTML).not.toMatch(/accent/);
      unmount();
    }
  });

  it("keeps the four departure marks inside the hand", () => {
    for (const mark of SITE_MARKS) expect(REEF_DRAWINGS).toContain(mark);
    // The turtle is the all-clear and the brain coral is a site, never a trip.
    expect(SITE_MARKS).not.toContain("turtle");
    expect(SITE_MARKS).not.toContain("site");
  });

  it("never sets a tile below the canvas's floor", () => {
    for (const [name, size] of Object.entries(SITE_MARK_SIZES)) {
      const heights = [...size.tile.matchAll(/h-\[(\d+)px\]|h-(\d+)\b/g)].map((m) =>
        m[1] ? Number(m[1]) : Number(m[2]) * 4,
      );
      expect(heights.length, `${name} states a height`).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(SITE_MARK_MIN_PX);
    }
  });

  it("draws the home's tile at the board's own size, on the inset rung", () => {
    // 84×60 is what the canvas drew for the spine's rail; 60×42 was the
    // *drawing's* size misread as the tile's until 2026-09-02.
    expect(SITE_MARK_SIZES.md.tile).toContain("h-[60px]");
    expect(SITE_MARK_SIZES.md.tile).toContain("w-[84px]");
    for (const size of Object.values(SITE_MARK_SIZES)) {
      expect(size.tile).not.toMatch(/rounded-(xl|2xl|3xl)\b/);
    }
  });
});

describe("the ground", () => {
  it("sits on the lagoon wash by default, and on the shell where the page is the wash", () => {
    // A prop, never a `className` override: two `bg-*` utilities on one
    // element resolve by Tailwind's emit order, not the caller's intent.
    const { container, unmount } = render(<SiteMark mark="reef" />);
    expect(container.querySelector("[data-site-mark]")?.className).toContain("bg-primary-tint");
    unmount();
    const shell = render(<SiteMark mark="reef" ground="surface" />);
    const tile = shell.container.querySelector("[data-site-mark]");
    expect(tile?.className).toContain("bg-surface ");
    expect(tile?.className).not.toContain("bg-primary-tint");
  });

  it("swaps wash and ink for a boat that leaves after dark, and fills its shapes from the deep", () => {
    const { container } = render(<SiteMark mark="open" ground="deep" />);
    const tile = container.querySelector("[data-site-mark]");
    expect(tile?.className).toContain(SITE_MARK_GROUNDS.deep);
    expect(SITE_MARK_GROUNDS.deep).toContain("bg-primary-hover");
    expect(SITE_MARK_GROUNDS.deep).toContain("text-primary-tint");
    // A closed shape is filled with the ground it sits on, so at night a
    // bubble is a ring in the wash rather than a white disc.
    expect(SITE_MARK_GROUNDS.deep).toContain("[--site-mark-fill:var(--primary-hover)]");
    expect(container.querySelector('[fill="var(--site-mark-fill)"]')).not.toBeNull();
  });

  it("reads the hour off the shop's clock, not the server's", () => {
    // 7:30 PM in Key Largo is 23:30 UTC — the deep either way; 7:00 AM there
    // is 11:00 UTC, day either way; 10 PM UTC is 6 PM in Key Largo (deep) but
    // still the afternoon in a shop three zones west.
    expect(siteMarkGroundFor(new Date("2026-08-27T23:30:00Z"), "America/New_York")).toBe("deep");
    expect(siteMarkGroundFor(new Date("2026-08-27T11:00:00Z"), "America/New_York")).toBe("tint");
    expect(siteMarkGroundFor(new Date("2026-08-27T22:00:00Z"), "America/New_York")).toBe("deep");
    expect(siteMarkGroundFor(new Date("2026-08-27T22:00:00Z"), "America/Los_Angeles")).toBe("tint");
    // Before five is still the night before.
    expect(siteMarkGroundFor(new Date("2026-08-27T08:30:00Z"), "America/New_York")).toBe("deep");
  });
});
