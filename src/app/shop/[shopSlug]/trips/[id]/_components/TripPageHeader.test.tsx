// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/ui/badge";
import { TripPageHeader, TripPageHeaderSkeleton } from "./TripPageHeader";

// The way up is read off the URL (issue #2748): a face of a departure links to
// the board above the departure, never to the departure itself.
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/trips/trip-1/manifest",
}));

afterEach(cleanup);

function renderHeader(actions?: ReactNode, stackActionsOnPhone = false) {
  return render(
    <TripPageHeader
      trip={{
        title: "Two-Tank Reef — Molasses & French",
        startsAt: new Date("2026-07-21T18:30:00Z"),
        endsAt: new Date("2026-07-21T22:00:00Z"),
      }}
      backLabel="Trip"
      locale="en-US"
      timeZone="America/New_York"
      actions={actions}
      stackActionsOnPhone={stackActionsOnPhone}
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
   * 16px eyebrow on a phone. Phone polish 2026-11-20: sharing the title's row
   * on a phone, "Roll call" and "More" squeezed the title into three lines.
   * Below `sm` the actions follow the facts; from it they end the title's row.
   */
  it("ends the title's row with one small door at every width", () => {
    renderHeader(<button type="button">More</button>);

    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(header).toHaveClass("grid-cols-[minmax(0,1fr)_auto]", "items-center");
    const slot = screen.getByRole("button", { name: "More" }).parentElement;
    expect(slot).toHaveClass("col-start-2", "row-start-2");
    expect(slot).not.toHaveClass("order-last");
  });

  it("puts two doors after the facts on a phone and at the end of the title's row from sm", () => {
    renderHeader(<button type="button">More</button>, true);

    const title = screen.getByRole("heading", { level: 1 });
    const header = title.parentElement;
    expect(header?.tagName).toBe("HEADER");
    expect(header).toHaveClass("grid", "sm:grid-cols-[minmax(0,1fr)_auto]");
    const slot = screen.getByRole("button", { name: "More" }).parentElement;
    expect(slot?.parentElement).toBe(header);
    expect(slot).toHaveClass("order-last", "sm:order-none", "sm:col-start-2", "sm:row-start-2");
    expect(slot).not.toContainElement(screen.getByRole("link", { name: "Trip" }));
    expect(title).toHaveClass("min-w-0");
  });

  /**
   * UX audit 2026-10-07, item 39: the Boat tab hides the shell, so "‹ Schedule"
   * was its only door and the day was two hops away.
   */
  it("draws one way up, the schedule, with no Today link (B53)", () => {
    render(
      <TripPageHeader
        trip={{
          title: "Two-Tank Reef",
          startsAt: new Date("2026-07-21T18:30:00Z"),
          endsAt: new Date("2026-07-21T22:00:00Z"),
        }}
        backLabel="Schedule"
        locale="en-US"
        timeZone="America/New_York"
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
    expect(screen.queryByRole("link", { name: "Today" })).toBeNull();
  });

  it("omits the parent link when the Trip page relies on the global navigation", () => {
    render(
      <TripPageHeader
        trip={{
          title: "Two-Tank Reef",
          startsAt: new Date("2026-07-21T18:30:00Z"),
          endsAt: new Date("2026-07-21T22:00:00Z"),
        }}
        locale="en-US"
        timeZone="America/New_York"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Two-Tank Reef");
  });

  it("gives the title the row alone when the surface has no actions", () => {
    renderHeader();

    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    // The way up, the title, the facts: no action slot holds a column.
    expect(header?.children).toHaveLength(3);
  });

  it("keeps a surface-only action in one slot", () => {
    renderHeader(<button type="button">More</button>);

    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    const actionSlot = screen.getByRole("button", { name: "More" }).parentElement;
    // The slot is the responsive hiding boundary; a second wrapper would
    // reserve a gap after the surface hides its action.
    expect(actionSlot?.parentElement).toBe(header);
  });
});

function loadedHeader() {
  return render(
    <TripPageHeader
      trip={{
        title: "Two-Tank Reef — Molasses & French",
        startsAt: new Date("2026-07-21T18:30:00Z"),
        endsAt: new Date("2026-07-21T22:00:00Z"),
      }}
      backLabel="Trip"
      locale="en-US"
      timeZone="America/New_York"
      badge={<Badge tone="primary">3 seats left</Badge>}
    />,
  ).container;
}

/** The type classes a line box is made of: a size and a leading, at each width. */
const lineType = (element: Element | null) =>
  (element?.className ?? "")
    .split(" ")
    .filter((token) => /^(?:sm:)?(?:text-\[|leading-)/.test(token));

/** The top margins an element sits at, at each width. */
const spacing = (element: Element | null | undefined) =>
  (element?.className ?? "").split(" ").filter((token) => /^(?:sm:)?mt-/.test(token));

/**
 * **`TripPageHeader` drawn as bars** (K-188). `/prep` stood in for it with
 * `<ShopPageHeader pending>`, which is the other header: no eyebrow where this one
 * always has its way back, a 44px title line where this one's is 26px on a
 * phone and 38px from `sm`, and a description bar this one never draws. The
 * packing list moved 12px when it landed at 1280.
 */
describe("TripPageHeaderSkeleton", () => {
  it("opens with a bar in the eyebrow's 16px line", () => {
    const loaded = loadedHeader();
    expect(screen.getByRole("link", { name: "Trip" }).closest("span.h-4")).not.toBeNull();
    const skeleton = render(<TripPageHeaderSkeleton />).container.firstElementChild;
    expect(skeleton?.firstElementChild).toHaveClass("h-4");
    expect(loaded.querySelector("header")).toHaveClass("mb-8");
    expect(skeleton).toHaveClass("mb-8");
  });

  it("omits the eyebrow space when the loaded Trip page has no backlink", () => {
    const skeleton = render(<TripPageHeaderSkeleton showBack={false} />).container
      .firstElementChild;
    expect(skeleton?.children).toHaveLength(2);
    expect(skeleton?.firstElementChild).not.toHaveClass("h-4");
  });

  it("draws the title's lines in the h1's own line box, spaced as the h1 is", () => {
    loadedHeader();
    const h1 = screen.getByRole("heading", { level: 1 });
    const skeleton = render(<TripPageHeaderSkeleton titleLines={{ base: 2, sm: 1 }} />).container;
    const title = skeleton.firstElementChild?.children[1];
    expect(spacing(title)).toEqual(spacing(h1));
    expect(lineType(h1).length).toBeGreaterThanOrEqual(2);
    // Two lines below `sm`, one from it: each is the h1's own line box.
    expect(title?.children).toHaveLength(2);
    for (const line of Array.from(title?.children ?? [])) {
      expect(line).toHaveClass("h-lh", ...lineType(h1));
    }
    expect(title?.children[1]).toHaveClass("sm:hidden");
  });

  it("draws the badge row where the h1's meta row sits, and no description", () => {
    loadedHeader();
    // With no actions, the meta row is the title's next sibling.
    const meta = screen.getByRole("heading", { level: 1 }).nextElementSibling;
    expect(meta?.textContent).toContain("3 seats left");
    const skeleton = render(<TripPageHeaderSkeleton />).container.firstElementChild;
    const row = skeleton?.children[2];
    expect(spacing(row)).toEqual(spacing(meta));
    // The capacity pill is `Badge`'s `md`: 4px, a 20px line, 4px.
    expect(row?.firstElementChild).toHaveClass("h-7", "rounded-full");
    // Eyebrow, title, the meta row: nothing stands in for a description line.
    expect(skeleton?.children).toHaveLength(3);
  });

  it("leaves the pill out for a header that draws none", () => {
    const skeleton = render(<TripPageHeaderSkeleton badge={false} />).container;
    expect(skeleton.querySelector(".rounded-full")).toBeNull();
  });
});
