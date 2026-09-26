// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TripPageHeader } from "./TripPageHeader";

afterEach(cleanup);

function renderHeader(actions?: ReactNode) {
  return render(
    <TripPageHeader
      trip={{
        title: "Two-Tank Reef — Molasses & French",
        startsAt: new Date("2026-07-21T18:30:00Z"),
        endsAt: new Date("2026-07-21T22:00:00Z"),
      }}
      boardHref="/shop/blue-mantis/trips/trip-1"
      backLabel="Trip"
      locale="en-US"
      timeZone="America/New_York"
      actions={actions}
    />,
  );
}

/**
 * The header the manifest, prep, guests and the printed packet share. Pinned
 * as structure, since jsdom has no layout; the pixel probe re-measures it.
 */
describe("TripPageHeader", () => {
  /**
   * K-196 and K-357: the manifest's 48px ••• sat in a grid cell beside the
   * 16px eyebrow on a phone, 16px under the eyebrow's centre and pushing the
   * title 49px down; from `sm` it moved to the title's row and top-aligned
   * there, 4px above the title's line. The title and the actions are one row
   * now, centred on each other, and the eyebrow keeps a line of its own.
   */
  it("centres the actions on the title's line, and leaves the eyebrow a line of its own", () => {
    renderHeader(<button type="button">More</button>);

    const title = screen.getByRole("heading", { level: 1 });
    const row = title.parentElement;
    expect(row).toHaveClass("flex", "items-center");
    expect(row).toContainElement(screen.getByRole("button", { name: "More" }));
    expect(row).not.toContainElement(screen.getByRole("link", { name: "Trip" }));
    expect(title).toHaveClass("min-w-0", "flex-1");
  });

  it("gives the title its row alone when the surface has no actions", () => {
    renderHeader();

    const title = screen.getByRole("heading", { level: 1 });
    expect(title.parentElement?.children).toHaveLength(1);
  });
});
