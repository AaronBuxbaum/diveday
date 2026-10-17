// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { routeFocus } from "@/lib/dive-site-route";
import { DiveSiteMap, type DiveSiteRouteMap } from "./DiveSiteMap";

afterEach(cleanup);

const t = diverTranslator("en-US");

/** A short swim around one mooring, which the figure crops in on. */
const SITE: DiveSiteRouteMap = {
  name: "Molasses Reef",
  forecastLatitude: 25.0106,
  forecastLongitude: -80.3764,
  routePoints: [
    { x: 40, y: 42 },
    { x: 48, y: 55 },
    { x: 58, y: 50 },
  ],
  routeLabel: null,
  routeNote: null,
  routeZoom: 15,
};

/**
 * **The start and the finish are dots** (docs/design/pixel-craft.md, class 2;
 * K-413). The briefing's route is a `0 0 100 100` box stretched over the frame
 * with `preserveAspectRatio="none"`, right for the line and wrong for a
 * circle, which it drew as an oval as wide as the frame is wide for its
 * height. The line stays in the stretched box; each end is a round box of its
 * own at its percentage.
 */
describe("DiveSiteMap's route ends", () => {
  it("draws no circle in the stretched box, and the two ends as round dots", () => {
    const { container } = render(<DiveSiteMap site={SITE} t={t} />);
    const stretched = container.querySelector('svg[preserveAspectRatio="none"]');
    expect(stretched?.querySelector("path")).not.toBeNull();
    expect(stretched?.querySelector("circle")).toBeNull();
    const dots = [...container.querySelectorAll("span.rounded-full")] as HTMLElement[];
    expect(dots).toHaveLength(2);
    const [start, finish] = dots;
    for (const dot of dots) {
      expect([...dot.classList].filter((token) => /^(size|w|h)-/.test(token))).toEqual([
        "size-3.5",
      ]);
    }
    expect(start).toHaveStyle({ left: "40%", top: "42%" });
    expect(finish).toHaveStyle({ left: "58%", top: "50%" });
    // Hollow start, filled finish: the one hue tells them apart that way.
    expect(start).toHaveClass("bg-surface", "border-primary");
    expect(finish).toHaveClass("bg-primary", "border-surface");
  });

  it("divides the crop's magnification back out of each dot", () => {
    const focus = routeFocus(SITE.routePoints);
    expect(focus?.scale).toBeGreaterThan(1);
    const { container } = render(<DiveSiteMap site={SITE} t={t} />);
    const dots = [...container.querySelectorAll("span.rounded-full")] as HTMLElement[];
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(dot.style.scale).toBe(String(1 / (focus?.scale ?? 1)));
  });
});

/**
 * **A map that is not loading says so, quietly, and keeps its ground** (issue
 * issue 2013). The frame paints over a sunken surface, and the line naming the site
 * is in the document but shown only while the frame marks itself failed.
 */
describe("DiveSiteMap when the map does not load (issue 2013)", () => {
  it("lays the frame over a sunken ground", () => {
    const { container } = render(<DiveSiteMap site={SITE} t={t} />);
    const frame = container.querySelector("iframe");
    expect(frame?.parentElement).toHaveClass("bg-surface-sunken");
  });

  it("names the site in a line that shows only once the frame says it failed", () => {
    const { container } = render(<DiveSiteMap site={SITE} t={t} />);
    const line = [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("The map for Molasses Reef is not loading."),
    );
    expect(line).toBeDefined();
    expect(line).toHaveClass("hidden", "group-has-[[data-map-state=failed]]/map:block");
    expect(container.querySelector(".group\\/map")?.contains(line ?? null)).toBe(true);
  });
});
