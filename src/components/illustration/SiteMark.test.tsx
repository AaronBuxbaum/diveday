// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SITE_MARKS } from "@/lib/site-mark";
import { SITE_MARK_GROUNDS, SITE_MARK_MIN_PX, SITE_MARK_SIZES, SiteMark } from "./SiteMark";

afterEach(cleanup);

/**
 * The illustration rule (ADR 20260901-diveday-reimagined, decision 1): one
 * hand, one coral detail per drawing, never below 20px, never on a safety or
 * payment surface, never as a status.
 */
describe("SiteMark", () => {
  it("draws every code the set carries, decoratively, with one coral detail each", () => {
    for (const mark of SITE_MARKS) {
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

  it("never sets a tile below the canvas's floor", () => {
    for (const [name, size] of Object.entries(SITE_MARK_SIZES)) {
      const heights = [...size.tile.matchAll(/h-\[(\d+)px\]|h-(\d+)\b/g)].map((m) =>
        m[1] ? Number(m[1]) : Number(m[2]) * 4,
      );
      expect(heights.length, `${name} states a height`).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(SITE_MARK_MIN_PX);
    }
  });

  /**
   * Where a drawing may not appear. Walks `src/app` for every importer of this
   * component and refuses any that lives under a manifest, roll call, cert,
   * waiver, order or payment surface — the rule is mechanical, not tasteful.
   */
  it("is imported by no safety or payment surface", () => {
    const root = path.resolve(__dirname, "../../app");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          /\.tsx?$/.test(entry) &&
          readFileSync(full, "utf8").includes("illustration/SiteMark")
        ) {
          importers.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(file).not.toMatch(
        /manifest|roll-call|rollcall|cert|waiver|order|payment|checkout|refund/i,
      );
    }
  });
});

describe("the ground", () => {
  it("sits on the lagoon wash by default, and on the shell where the page is the wash", () => {
    // A prop, never a `className` override: two `bg-*` utilities on one
    // element resolve by Tailwind's emit order, not the caller's intent.
    const { container, unmount } = render(<SiteMark mark="reef" />);
    expect(container.querySelector("[data-site-mark]")?.className).toContain(
      SITE_MARK_GROUNDS.tint,
    );
    unmount();
    const shell = render(<SiteMark mark="reef" ground="surface" />);
    const tile = shell.container.querySelector("[data-site-mark]");
    expect(tile?.className).toContain(SITE_MARK_GROUNDS.surface);
    expect(tile?.className).not.toContain(SITE_MARK_GROUNDS.tint);
  });
});
