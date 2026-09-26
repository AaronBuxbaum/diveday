// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { REEF_DRAWINGS, SITE_MARKS, siteMarkGroundFor } from "@/lib/site-mark";
import { SITE_MARK_GROUNDS, SITE_MARK_MIN_PX, SITE_MARK_SIZES, SiteMark } from "./SiteMark";

afterEach(cleanup);

type Extent = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Where a drawing's lines actually run in its 120×80 canvas: every path's
 * points and curve extremes, and every circle's edge. Absolute and relative
 * `M L H V C S Q T Z`, which is what the hand draws in; an arc throws, so a
 * redraw that reaches for one fails here rather than measuring wrong.
 */
function inkExtent(svg: Element): Extent {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  // The extremes of one axis of a cubic from p0 to p3, where its derivative is 0.
  const cubicExtremes = (p0: number, p1: number, p2: number, p3: number) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const roots =
      Math.abs(a) < 1e-9
        ? Math.abs(b) < 1e-9
          ? []
          : [-c / b]
        : b * b - 4 * a * c < 0
          ? []
          : [1, -1].map((sign) => (-b + sign * Math.sqrt(b * b - 4 * a * c)) / (2 * a));
    return roots
      .filter((t) => t > 0 && t < 1)
      .map(
        (t) =>
          (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3,
      );
  };
  const cubic = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number,
  ) => {
    add(x, y);
    for (const ex of cubicExtremes(x0, x1, x2, x)) xs.push(ex);
    for (const ey of cubicExtremes(y0, y1, y2, y)) ys.push(ey);
  };

  for (const path of svg.querySelectorAll("path")) {
    const tokens = path.getAttribute("d")?.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let lastControl: [number, number] | null = null;
    let lastQuad: [number, number] | null = null;
    let command = "";
    let index = 0;
    const next = () => Number(tokens[index++]);
    while (index < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[index] ?? "")) command = tokens[index++] ?? "";
      const relative = command === command.toLowerCase();
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      switch (command.toUpperCase()) {
        case "M":
          x = ox + next();
          y = oy + next();
          startX = x;
          startY = y;
          add(x, y);
          // Pairs after a moveto are linetos.
          command = relative ? "l" : "L";
          lastControl = lastQuad = null;
          continue;
        case "L":
          x = ox + next();
          y = oy + next();
          add(x, y);
          lastControl = lastQuad = null;
          continue;
        case "H":
          x = ox + next();
          add(x, y);
          lastControl = lastQuad = null;
          continue;
        case "V":
          y = oy + next();
          add(x, y);
          lastControl = lastQuad = null;
          continue;
        case "C": {
          const [x1, y1, x2, y2, ex, ey] = [
            ox + next(),
            oy + next(),
            ox + next(),
            oy + next(),
            ox + next(),
            oy + next(),
          ];
          cubic(x, y, x1, y1, x2, y2, ex, ey);
          lastControl = [x2, y2];
          lastQuad = null;
          x = ex;
          y = ey;
          continue;
        }
        case "S": {
          const [x1, y1] = lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
          const [x2, y2, ex, ey] = [ox + next(), oy + next(), ox + next(), oy + next()];
          cubic(x, y, x1, y1, x2, y2, ex, ey);
          lastControl = [x2, y2];
          lastQuad = null;
          x = ex;
          y = ey;
          continue;
        }
        case "Q":
        case "T": {
          // Declared, not inferred: `lastQuad` is assigned from these below,
          // so an inferred type would be read through its own initializer.
          let qx: number = x;
          let qy: number = y;
          if (command.toUpperCase() === "Q") {
            qx = ox + next();
            qy = oy + next();
          } else if (lastQuad) {
            qx = 2 * x - lastQuad[0];
            qy = 2 * y - lastQuad[1];
          }
          const [ex, ey] = [ox + next(), oy + next()];
          // A quadratic is the cubic with control points two thirds of the way.
          cubic(
            x,
            y,
            x + (2 / 3) * (qx - x),
            y + (2 / 3) * (qy - y),
            ex + (2 / 3) * (qx - ex),
            ey + (2 / 3) * (qy - ey),
            ex,
            ey,
          );
          lastQuad = [qx, qy];
          lastControl = null;
          x = ex;
          y = ey;
          continue;
        }
        case "Z":
          x = startX;
          y = startY;
          lastControl = lastQuad = null;
          continue;
        default:
          throw new Error(`inkExtent cannot measure the path command "${command}"`);
      }
    }
  }
  for (const circle of svg.querySelectorAll("circle")) {
    const [cx, cy, r] = ["cx", "cy", "r"].map((name) => Number(circle.getAttribute(name)));
    add(cx - r, cy - r);
    add(cx + r, cy + r);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

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

  it("centres the boat in its canvas, and keeps its stroke inside it", () => {
    // The boat's lines ran x 6–120 and y 22–76 of the 120×80 canvas, whose
    // centre is (60, 40): its ink sat 2.5px low and 1.5px right in the 44×30
    // tile, and the swell's right end ran into the canvas edge, which cut its
    // stroke. Measured, not pinned: any redraw may move every point, so long as
    // everything it draws, the buoy and the wake mark included, is centred on
    // the canvas in its own coordinates. The tile is never nudged instead.
    const { container } = render(<SiteMark mark="boat" />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no svg drawn");
    const ink = inkExtent(svg);

    expect((ink.minX + ink.maxX) / 2).toBeCloseTo(60, 0);
    expect((ink.minY + ink.maxY) / 2).toBeCloseTo(40, 0);
    // Half the 1.7 stroke, and the round caps, reach past the lines' ends.
    const half = 1.7 / 2;
    expect(ink.minX - half).toBeGreaterThanOrEqual(0);
    expect(ink.maxX + half).toBeLessThanOrEqual(120);
    expect(ink.minY - half).toBeGreaterThanOrEqual(0);
    expect(ink.maxY + half).toBeLessThanOrEqual(80);
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
