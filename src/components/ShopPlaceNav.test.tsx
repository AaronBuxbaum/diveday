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
    // The gear register lives behind the shop's name, not in the bar. A nav
    // that lit Today anyway would be telling the reader they are somewhere
    // they are not.
    pathname = `${ROOT}/gear`;
    render(<ShopPlaceNav root={ROOT} gates={owner} copy={COPY} />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
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
