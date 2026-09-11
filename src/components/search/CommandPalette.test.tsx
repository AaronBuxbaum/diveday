// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
      gates={{ waivers: true, reports: true, team: true, settings: true, inbox: true }}
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
