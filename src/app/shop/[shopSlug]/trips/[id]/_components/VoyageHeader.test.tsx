// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { dayStripGeometry } from "@/lib/day-strip";
import { TripAddDiverLink } from "./TripPageHeader";
import { VoyageHeader } from "./VoyageHeader";

afterEach(cleanup);

const strip = {
  geometry: dayStripGeometry({
    from: new Date("2026-09-19T10:00:00.000Z"),
    to: new Date("2026-09-19T16:00:00.000Z"),
    now: new Date("2026-09-19T10:58:00.000Z"),
    daylight: [
      {
        sunriseAt: new Date("2026-09-19T11:00:00.000Z"),
        sunsetAt: new Date("2026-09-19T23:00:00.000Z"),
      },
    ],
    daylightProgress: null,
    marks: [
      { id: "off", at: new Date("2026-09-19T11:00:00.000Z") },
      { id: "back", at: new Date("2026-09-19T15:45:00.000Z") },
    ],
    ticks: [],
  }),
  label: "Two-Tank Reef, drawn as its voyage.",
  markLabels: { off: "7:00 AM", back: "11:45 AM" },
};

describe("VoyageHeader", () => {
  /**
   * **The hour is the name.** A crew standing on a dock at 6:58 knows which
   * trip it is; what they need first is the time it leaves. So the time takes
   * the display size, and the title reads under it — which means the `<h1>` is
   * the title and the hour is not a heading competing with it.
   */
  it("leads with the hour and keeps the title as the page's heading", () => {
    const { container } = render(
      <VoyageHeader
        scheme="dawn"
        back={<a href="/shop/blue-mantis/schedule/board">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef — Molasses & French"
        line="Mantis I · Keiko Tanaka · 9 of 12 seats taken"
        strip={strip}
      />,
    );
    // The hour twice on purpose: once as the page's name in the display face,
    // and once as the label on the mark the strip draws it at — which is what
    // the canvas draws too. The first is what this asserts.
    expect(container.querySelector(".font-rounded")?.textContent).toBe("7:00 AM");
    expect(screen.getAllByText("7:00 AM").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Two-Tank Reef — Molasses & French" }),
    ).toBeTruthy();
    expect(screen.getByText("Mantis I · Keiko Tanaka · 9 of 12 seats taken")).toBeTruthy();
  });

  it("wears the hour it is read at, and nothing else decides it", () => {
    const { container } = render(
      <VoyageHeader
        scheme="dusk"
        back={<a href="/back">Board</a>}
        hour="7:30 PM"
        title="Night Dive"
        line="Skiff · 3 of 8 seats taken"
        strip={null}
      />,
    );
    expect(container.querySelector(".sky")?.getAttribute("data-scheme")).toBe("dusk");
  });

  /**
   * The strip is one image to a screen reader, because everything on it is
   * said again in the line above and the roster below.
   */
  it("draws the voyage as one image, and draws none where there is nothing to draw", () => {
    const { rerender } = render(
      <VoyageHeader
        scheme="day"
        back={<a href="/back">Board</a>}
        hour="1:00 PM"
        title="Wreck Trip"
        line="Mantis II · 12 of 12 seats taken"
        strip={strip}
      />,
    );
    expect(screen.getByRole("img", { name: /drawn as its voyage/ })).toBeTruthy();
    rerender(
      <VoyageHeader
        scheme="day"
        back={<a href="/back">Board</a>}
        hour="1:00 PM"
        title="Wreck Trip"
        line="Mantis II · 12 of 12 seats taken"
        strip={null}
      />,
    );
    expect(screen.queryByRole("img", { name: /drawn as its voyage/ })).toBeNull();
  });

  /**
   * **A blow-out rides the sky.** It is the first thing a crew must read, and
   * the words under the band are further down the page than the decision to
   * drive to the dock is made.
   */
  it("carries a cancelled badge beside the hour, not below the fold", () => {
    const { container } = render(
      <VoyageHeader
        scheme="dawn"
        back={<a href="/back">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef"
        line="Mantis I · 9 of 12 seats taken"
        strip={null}
        badge={<span>Cancelled</span>}
      />,
    );
    const sky = container.querySelector(".sky");
    expect(sky?.textContent).toContain("Cancelled");
  });

  /**
   * **The band's controls wear the band's ink.**
   *
   * This shipped with the way back and "Add diver" both in `text-primary`,
   * which the captured pixels measured at **1.76:1** against `--sky-day` —
   * the page's door and its primary act, both effectively invisible, with
   * every component test, page test and repository guard green. So the two
   * controls the real header passes are rendered here as the real header
   * passes them, and the accent is what this refuses.
   */
  it("gives the way back and the action the sky's ink, never the accent", () => {
    const { container } = render(
      <VoyageHeader
        scheme="day"
        back={
          <EyebrowBackLink onSky href="/shop/blue-mantis/schedule/board">
            Board
          </EyebrowBackLink>
        }
        hour="2:30 PM"
        title="Two-Tank Reef"
        line="Mantis I · 9 of 12 seats taken"
        strip={null}
        action={<TripAddDiverLink onSky href="#add-diver" label="Add diver" />}
      />,
    );
    const back = container.querySelector('a[href="/shop/blue-mantis/schedule/board"]');
    const action = container.querySelector('a[href="#add-diver"]');
    expect(back?.className).toContain("text-(--sky-ink)");
    expect(back?.className).not.toContain("text-primary");
    expect(action?.className).toContain("text-(--sky-ink)");
    expect(action?.className).not.toContain("text-primary");
  });

  /**
   * The same two components off the sky keep the accent they have everywhere
   * else — the fix is a band's ink, not a repaint of the app.
   */
  it("leaves both controls on the accent when they are not on a sky", () => {
    const { container } = render(
      <>
        <EyebrowBackLink href="/shop/blue-mantis/schedule/board">Board</EyebrowBackLink>
        <TripAddDiverLink href="#add-diver" label="Add diver" />
      </>,
    );
    expect(
      container.querySelector('a[href="/shop/blue-mantis/schedule/board"]')?.className,
    ).toContain("text-primary");
    expect(container.querySelector('a[href="#add-diver"]')?.className).toContain("text-primary");
  });
});
