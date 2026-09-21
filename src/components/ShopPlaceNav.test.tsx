// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffDestinationGates } from "@/lib/staff-destinations";
import { ShopPlaceMenu, ShopPlaceNav, type ShopPlaceNavCopy } from "./ShopPlaceNav";

let pathname = "/shop/blue-mantis";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(cleanup);

const ROOT = "/shop/blue-mantis";

const owner: StaffDestinationGates = {
  waivers: true,
  reports: true,
  team: true,
  settings: true,
};

const crew: StaffDestinationGates = {
  waivers: false,
  reports: false,
  team: false,
  settings: false,
};

const COPY: ShopPlaceNavCopy = {
  navAriaLabel: "When",
  places: { day: "Today", week: "Week", season: "Season" },
  blockedLabel: "3 divers blocked",
};

/**
 * The two forms of one nav. Everything asserted here is asserted of **both**
 * wherever it can be: the desk bar's pills and the phone's folded calendar are
 * a single idea rendered twice, and the failure worth catching is the one
 * where they come apart.
 */
describe("ShopPlaceNav — the three times as pills", () => {
  it("wears exactly the three, in the order the day runs", () => {
    pathname = ROOT;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Today", "Week", "Season"]);
  });

  it("lights the time the reader is standing in, and only that one", () => {
    pathname = `${ROOT}/schedule/board`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    const current = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));
    expect(current.map((link) => link.textContent)).toEqual(["Week"]);
  });

  it("lights nothing at all in a place that has no hour", () => {
    // The site library is one of the things a shop *sets up*, so it lives
    // behind the shop's name rather than in the bar, and a nav that lit one
    // of the three anyway would be telling the reader they are somewhere they
    // are not.
    //
    // It used to be the gear register here, which read as the same kind of
    // thing and was not: chasing a wetsuit is the day's work, and Settings
    // had no door to the fleet for it to live behind (#1937). The pair the
    // place actually depends on — a `shop` destination and its door — is held
    // by `settings/settings-doors.test.ts`.
    pathname = `${ROOT}/dive-sites`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    // Every link, not `queryByRole({ current: "page" })`: a bar that lit one
    // of the three as `"true"` would satisfy that query too, and the claim
    // here is that nothing is lit at all.
    for (const link of screen.getAllByRole("link")) {
      expect(link, link.textContent ?? "").not.toHaveAttribute("aria-current");
    }
  });

  it("lights Today for the gear register, which has an hour in it", () => {
    // The paired positive, and the reason the absence above is worth
    // asserting at all: this component *can* light a destination that is not
    // one of the bar's own three, so the null above is a reading of the
    // place rather than a nav that lights nothing anywhere.
    pathname = `${ROOT}/gear`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.getByRole("link", { current: true })).toHaveTextContent("Today");
  });

  /**
   * **A place is not a page, and `aria-current` has a word for each.**
   *
   * The bar's three are times. On most staff URLs the lit one's link navigates
   * away — `/divers` lights Today, whose link opens the shop root — so a
   * staffer on a screen reader heard "Today, current page" about somewhere
   * they were not (#1938). `"page"` is the current page within a set of links
   * to pages; `"true"` is the current item in a set, not otherwise specified.
   *
   * The two below are the pair: the same pill, lit both times, saying
   * different things because the reader is standing somewhere different.
   * Neither is interesting alone — one of them passes under a bar that has
   * given up and marks nothing, and the other under the flat `"page"` this
   * replaced.
   */
  it("says “page” when the lit place's own link is the page being read", () => {
    pathname = ROOT;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("says “true” when the lit place's link goes somewhere else", () => {
    pathname = `${ROOT}/divers`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "true");
  });

  /**
   * The case that decides *how* the question is asked, and the reason this is
   * an href comparison rather than a destination-id one. `board` carries
   * `alsoMatch: ["/trips"]`, so a departure resolves to the board destination
   * while sitting at a path the Week link does not open — an id comparison
   * would call it "page" and re-open the bug on the busiest staff surface.
   */
  it("says “true” on a departure, which the Week link claims but does not open", () => {
    pathname = `${ROOT}/trips/7f3a`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "true");
  });

  it("drops Season for a reader who may not read it, rather than refusing them", () => {
    pathname = ROOT;
    render(<ShopPlaceNav root={ROOT} gates={crew} copy={COPY} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Today", "Week"]);
  });

  it("says the whole sentence about a blocked diver, not only the digit", () => {
    pathname = ROOT;
    render(<ShopPlaceNav root={ROOT} gates={owner} blocked={3} copy={COPY} />);
    expect(screen.getByRole("link", { name: /Today/ })).toHaveTextContent("3 divers blocked");
  });

  it("carries no count when nobody is held back", () => {
    pathname = ROOT;
    render(<ShopPlaceNav root={ROOT} gates={owner} blocked={0} copy={COPY} />);
    expect(screen.queryByText("3 divers blocked")).toBeNull();
  });
});

describe("ShopPlaceMenu — the same three, folded into the phone's date", () => {
  it("is one button until it is opened, and the button is not a link", async () => {
    // The whole point of the fold: a 390px bar cannot hold three words and a
    // shop's name, so at rest this costs one tap target.
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    const trigger = screen.getByRole("button", { name: "When" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on the same three times the pills wear", async () => {
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: "When" }));
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Today",
      "Week",
      "Season",
    ]);
  });

  it("lights the time the reader is standing in, exactly as the pills do", async () => {
    pathname = `${ROOT}/schedule/board`;
    render(<ShopPlaceMenu root={ROOT} gates={owner} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: "When" }));
    const current = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));
    expect(current.map((link) => link.textContent)).toEqual(["Week"]);
  });

  it("draws the same distinction between a place and a page the pills draw", async () => {
    // Both readings on the folded form, because the two are one idea rendered
    // twice and the failure worth catching is the one where they come apart.
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: "When" }));
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

    cleanup();
    pathname = `${ROOT}/divers`;
    render(<ShopPlaceMenu root={ROOT} gates={owner} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: "When" }));
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "true");
  });

  it("hides the same time from the same reader the pills hide it from", async () => {
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={crew} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: "When" }));
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Today", "Week"]);
  });

  it("tells a closed button that somebody is held back, in words and not only in colour", () => {
    // The dot is the signal; this is the sentence behind it. A staffer using a
    // screen reader must not have to open the menu to learn there is a
    // blocked diver — the desk bar does not make them open anything.
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} blocked={3} copy={COPY} />);
    expect(screen.getByRole("button", { name: /When/ })).toHaveTextContent("3 divers blocked");
  });

  it("carries the digit inside, on the row whose word explains it", async () => {
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} blocked={3} copy={COPY} />);
    await userEvent.click(screen.getByRole("button", { name: /When/ }));
    expect(screen.getByRole("link", { name: /Today/ })).toHaveTextContent("3");
  });

  it("says nothing about blocked divers when there are none", () => {
    pathname = ROOT;
    render(<ShopPlaceMenu root={ROOT} gates={owner} blocked={0} copy={COPY} />);
    expect(screen.getByRole("button", { name: "When" })).not.toHaveTextContent("blocked");
  });
});
