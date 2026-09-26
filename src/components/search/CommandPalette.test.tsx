// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResults } from "@/db/search";
import type { StaffDestinationLabels } from "@/lib/staff-destinations";
import { CommandPalette, type CommandPaletteCopy } from "./CommandPalette";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

/** Every destination labelled by its own id — the labels are not what these tests read. */
const labels = new Proxy({}, { get: (_, id) => String(id) }) as StaffDestinationLabels;

const COPY: CommandPaletteCopy = {
  search: "Search",
  dialogAriaLabel: "Search this shop",
  comboboxAriaLabel: "Search divers, trips, and more",
  placeholder: "Type a name, a day, a departure",
  emptyShort: "Keep typing",
  emptyNoMatches: "Nothing matches",
  groupDivers: "Divers",
  addDiver: "Add a diver",
  groupTrips: "Departures",
  groupDiveSites: "Dive sites",
  groupCourses: "Courses",
  groupOrders: "Orders",
  groupGear: "Gear",
  gearStatuses: { in_service: "In service", needs_service: "Needs service" },
  groupGoTo: "Go to",
  language: "Language",
  groupSession: "This session",
  signOut: "Sign out",
  hintMove: "to move",
  hintOpen: "to open",
  hintClose: "to close",
  destinationLabels: labels,
  destinationTitles: {},
  goToBoarding: "Boarding",
  goToCloseDay: "Close the day",
  goToOfflineRollCall: "Offline roll call",
};

const ANSWER: NonNullable<SearchResults["answer"]> = {
  kind: "diver",
  title: "Grace Mensah on the 7:00 AM Thu, Aug 27 · Two-Tank Reef",
  lines: ["Blocked · Waiver not sent"],
  act: { label: "Open the roster", href: "/shop/blue-mantis/trips/t-1#booking-b-1" },
  more: { label: "Open Grace Mensah’s record", href: "/shop/blue-mantis/divers/p-grace" },
};

function results(answer: SearchResults["answer"]): SearchResults {
  return {
    answer,
    divers: [{ id: "p-grace", fullName: "Grace Mensah", detail: null }],
    trips: [],
    diveSites: [],
    courses: [],
    orders: [],
    gear: [],
  };
}

function renderPalette() {
  return render(
    <CommandPalette
      shopSlug="blue-mantis"
      gates={{ waivers: true, reports: true, team: true, settings: true }}
      locale="en-US"
      languages={[]}
      setLocaleAction={async () => {}}
      signOutAction={async () => {}}
      createDiverAction={async () => {}}
      copy={COPY}
    />,
  );
}

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  vi.unstubAllGlobals();
});

/** ADR 20260906-before-you-ask, decision 3: ask it, and it answers. */
describe("CommandPalette answer card", () => {
  it("is the first row when the query names one thing, and Enter takes its act", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(results(ANSWER)), { status: 200 })),
    );
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "gra");

    const card = await screen.findByRole("option", { name: ANSWER.title });
    const options = screen.getAllByRole("option");
    expect(options[0]).toBe(card);
    expect(card).toHaveTextContent("Blocked · Waiver not sent");
    expect(card).toHaveTextContent("Open the roster");
    // The doors that ship today render beneath it.
    expect(screen.getByRole("option", { name: "Open Grace Mensah’s record" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Grace Mensah" })).toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(routerPush).toHaveBeenCalledWith("/shop/blue-mantis/trips/t-1#booking-b-1");
  });

  it("renders no card at all when the query names nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(results(null)), { status: 200 })),
    );
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "gra");
    await screen.findByRole("option", { name: "Grace Mensah" });
    await waitFor(() => expect(screen.queryByText("Open the roster")).not.toBeInTheDocument());
    expect(screen.getAllByRole("option")[0]).not.toHaveTextContent("↵");
  });
});

/**
 * The key caps are one box. The arrow caps hold a 12px glyph, whose line box
 * made them 18px tall beside the 16px text caps (↵, esc) in the same legend
 * (the pixel audit, command-palette): a fixed-height flex box centres either.
 */
describe("CommandPalette key caps", () => {
  it("draws every key cap at one fixed height, glyph or word", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(results(ANSWER)), { status: 200 })),
    );
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "gra");
    await screen.findByRole("option", { name: ANSWER.title });

    const caps = [...screen.getByRole("dialog").querySelectorAll("kbd")];
    // The answer card's ↵, and the legend's ↑ ↓ ↵ esc.
    expect(caps).toHaveLength(5);
    for (const cap of caps) expect(cap).toHaveClass("inline-flex", "h-4", "items-center");
  });
});

/**
 * A departure's name is the thing a staffer is looking for, and on a phone the
 * row gave it all the loss: the date beside it never shrank, so "Two-Tank Reef
 * — Benwood & Molasses" was cut to 81px while its date kept 172 (the pixel
 * audit, command-palette-results at 390). Below `sm` the detail is the label's
 * second line; from `sm` up the one column lays the two out side by side.
 */
describe("CommandPalette result detail", () => {
  it("sets a result's detail under its label below `sm`, and beside it from `sm` up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...results(null),
              trips: [
                {
                  id: "t-1",
                  title: "Two-Tank Reef — Benwood & Molasses",
                  detail: "7:00 AM Thu, Aug 27",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "reef");

    const option = await screen.findByRole("option", {
      name: "Two-Tank Reef — Benwood & Molasses",
    });
    const detail = within(option).getByText("7:00 AM Thu, Aug 27");
    const label = within(option).getByText("Two-Tank Reef — Benwood & Molasses");
    // One column holds both, so the detail is never a second copy.
    expect(detail.parentElement).toBe(label.parentElement);
    expect(detail.parentElement).toHaveClass("min-w-0", "flex-1", "sm:flex");
    expect(label).toHaveClass("block", "truncate", "sm:flex-1");
    expect(detail).toHaveClass("block", "truncate", "sm:shrink-0");
  });
});

/**
 * The field is the palette's one focus stop, flush with the dialog's
 * `overflow-hidden` on three sides: the outset global ring was cut to a bar
 * under it, and switching the ring off to hide the bar left the field with no
 * focus state at all (review, 2026-09-25). jsdom has no layout, so this pins
 * which element carries what; the pixel probe measures the ring.
 */
describe("CommandPalette search field focus", () => {
  it("lands focus in the field, which wears the inset ring at the dialog's top radius and never switches its outline off", async () => {
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));

    const field = screen.getByRole("combobox");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveClass("focus-visible:focus-ring-inset", "rounded-t-panel");
    expect(field.className).not.toMatch(/(^|[\s:])outline-(none|hidden|0)(\s|$)/);
    expect(screen.getByRole("dialog")).toHaveClass("overflow-hidden", "rounded-panel");
  });
});
