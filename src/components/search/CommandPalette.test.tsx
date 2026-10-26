// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  searching: "Searching…",
  searchFailed: "Search unavailable.",
  searchUnauthorized: "Sign in again to search records.",
  retry: "Try again",
  signInAgain: "Sign in",
  groupDivers: "Divers",
  addDiver: "Add a diver",
  groupTrips: "Departures",
  groupDiveSites: "Dive sites",
  groupCourses: "Courses",
  groupOrders: "Orders",
  groupGear: "Gear",
  gearStatuses: { in_service: "In service", needs_service: "Needs service" },
  groupGoTo: "Go to",
  groupRecent: "Recent",
  groupToday: "Today",
  language: "Language",
  groupSession: "This session",
  signOut: "Sign out",
  hintMove: "to move",
  hintOpen: "to open",
  hintClose: "to close",
  close: "Close",
  destinationLabels: labels,
  destinationTitles: {},
  goToBoarding: "Boarding",
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

function renderPalette(
  settingsShortcuts?: Parameters<typeof CommandPalette>[0]["settingsShortcuts"],
  props: Partial<Parameters<typeof CommandPalette>[0]> = {},
) {
  return render(
    <CommandPalette
      shopSlug="blue-mantis"
      gates={{
        waivers: true,
        reports: true,
        team: true,
        settings: true,
        boats: true,
        tripTags: true,
        safetyChecklist: true,
      }}
      locale="en-US"
      languages={[]}
      setLocaleAction={async () => {}}
      signOutAction={async () => {}}
      createDiverAction={async () => {}}
      settingsShortcuts={settingsShortcuts}
      copy={COPY}
      {...props}
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
    expect(field).toHaveClass("focus-visible:focus-ring-inset", "rounded-ss-panel");
    expect(field.className).not.toMatch(/(^|[\s:])outline-(none|hidden|0)(\s|$)/);
    expect(screen.getByRole("dialog")).toHaveClass("overflow-hidden", "rounded-panel");
  });
});

/** The keyboard contract every modal layer shares (`useDialogBehaviour`), held on ⌘K. */
describe("CommandPalette keyboard contract", () => {
  it("is a modal dialog that Escape closes, handing focus back to the button that opened it", async () => {
    renderPalette();
    const opener = screen.getByRole("button", { name: /Search/ });
    await userEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Search this shop" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("flags its trigger hydrated once the ⌘K listener is attached", () => {
    // A ⌘K pressed before the listener exists is lost, and the e2e captures
    // waited on nothing that said it was there (issue #2366).
    renderPalette();
    expect(screen.getByRole("button", { name: /Search/ })).toHaveAttribute("data-hydrated", "true");
  });

  it("opens and closes from ⌘K anywhere", async () => {
    renderPalette();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "Search this shop" })).toBeInTheDocument();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

/** ⌘K reaches a setting: the Settings rail's rows answer by label or group. */
describe("CommandPalette settings shortcuts", () => {
  const SHORTCUTS = [
    { id: "tips", label: "Tips", group: "Money", href: "/shop/blue-mantis/settings#tips" },
    {
      id: "deskHours",
      label: "Desk hours",
      group: "Notifications",
      href: "/shop/blue-mantis/settings#desk-hours",
    },
    // The same page as the `team` destination: offered once, as that.
    { id: "team", label: "Team", group: "Team", href: "/shop/blue-mantis/settings/team" },
  ];

  function stubEmptySearch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(results(null)), { status: 200 })),
    );
  }

  it("finds a setting by its own name, with its group beside it", async () => {
    stubEmptySearch();
    renderPalette(SHORTCUTS);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "tips");
    const option = await screen.findByRole("option", { name: /Tips/ });
    expect(option).toHaveTextContent("Money");
    await userEvent.click(option);
    expect(routerPush).toHaveBeenCalledWith("/shop/blue-mantis/settings#tips");
  });

  it("finds a group's rows by the group's name, and offers none before anything is typed", async () => {
    stubEmptySearch();
    renderPalette(SHORTCUTS);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(screen.queryByRole("option", { name: /Desk hours/ })).toBeNull();
    await userEvent.type(screen.getByRole("combobox"), "notif");
    expect(await screen.findByRole("option", { name: /Desk hours/ })).toBeInTheDocument();
  });

  it("names a row after its group when a destination already carries its label", async () => {
    // "Crew schedule" is both the staffing destination and a Settings row
    // (the switch that turns the schedule on). Two options with one name is
    // one too many for a reader and for a locator (e2e/search.spec.ts), so the
    // rail's row carries its group in its accessible name.
    stubEmptySearch();
    renderPalette([
      ...SHORTCUTS,
      {
        id: "crewSchedule",
        label: "Crew schedule",
        group: "Rarely changed",
        href: "/shop/blue-mantis/settings#crew-schedule",
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "crew schedule");
    const option = await screen.findByRole("option", { name: "Crew schedule · Rarely changed" });
    expect(option).toHaveTextContent("Crew schedule");
    expect(screen.queryByRole("option", { name: "Crew schedule" })).toBeNull();
  });

  it("never offers a page twice when it is already a destination", async () => {
    stubEmptySearch();
    renderPalette(SHORTCUTS);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "team");
    // The registry's row (labelled by its id here); the rail's "Team" is skipped.
    expect(await screen.findByRole("option", { name: "team" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Team" })).toBeNull();
  });
});

/**
 * **⌘K opens on what you were just doing** (fifth loop, item 13): the records
 * this staffer last opened from it on this device, then today's boats, before
 * anything is typed. Browser storage only, per shop and per staffer.
 */
describe("CommandPalette recents and today's boats", () => {
  afterEach(() => window.localStorage.clear());

  function renderWith(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
    return render(
      <CommandPalette
        shopSlug="blue-mantis"
        gates={{
          waivers: true,
          reports: true,
          team: true,
          settings: true,
          boats: true,
          tripTags: true,
          safetyChecklist: true,
        }}
        locale="en-US"
        languages={[]}
        setLocaleAction={async () => {}}
        signOutAction={async () => {}}
        createDiverAction={async () => {}}
        readerId="p-desk"
        copy={COPY}
        {...props}
      />,
    );
  }

  it("remembers a diver opened from it by id only, and opens on them next time", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(results(null)), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(screen.getByRole("combobox"), "gra");
    await userEvent.click(await screen.findByRole("option", { name: "Grace Mensah" }));
    expect(routerPush).toHaveBeenCalledWith("/shop/blue-mantis/divers/p-grace");
    // The device keeps which record, never its name or contact line.
    expect(
      JSON.parse(window.localStorage.getItem("diveday.palette.recent.blue-mantis.p-desk") ?? ""),
    ).toEqual([{ key: "diver:p-grace", kind: "diver", id: "p-grace" }]);

    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/search?recent=${encodeURIComponent("diver:p-grace")}`,
      expect.anything(),
    );
    const first = await screen.findByRole("option", { name: "Grace Mensah" });
    expect(screen.getAllByRole("option")[0]).toBe(first);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("drops a remembered record that no longer reads back, and forgets it", async () => {
    window.localStorage.setItem(
      "diveday.palette.recent.blue-mantis.p-desk",
      JSON.stringify([{ key: "diver:p-gone", kind: "diver", id: "p-gone" }]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...results(null), divers: [] }))),
    );
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await waitFor(() =>
      expect(window.localStorage.getItem("diveday.palette.recent.blue-mantis.p-desk")).toBe("[]"),
    );
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("keeps one staffer's recents from the next one on the same device", async () => {
    window.localStorage.setItem(
      "diveday.palette.recent.blue-mantis.p-owner",
      JSON.stringify([{ key: "diver:p-grace", kind: "diver", id: "p-grace" }]),
    );
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(results(null))));
    vi.stubGlobal("fetch", fetchMock);
    renderWith();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("offers today's boats under Today before anything is typed, and not once a query is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(results(null)), { status: 200 })),
    );
    renderWith({ todayBoats: [{ id: "t-1", title: "Two-Tank Reef", time: "7:00 AM" }] });
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    const boat = screen.getByRole("option", { name: "Two-Tank Reef" });
    expect(boat).toHaveTextContent("7:00 AM");
    await userEvent.type(screen.getByRole("combobox"), "gra");
    await screen.findByRole("option", { name: "Grace Mensah" });
    expect(screen.queryByRole("option", { name: "Two-Tank Reef" })).toBeNull();
  });
});

/** Request boundaries: a typed query never borrows another request's records. */
describe("CommandPalette search request lifecycle", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const empty = { ...results(null), divers: [] };
  const response = (value: SearchResults) => new Response(JSON.stringify(value));

  async function openQuery(query: string) {
    renderPalette();
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  }

  it("removes the old answer and record during the next query's debounce, before Enter or click", async () => {
    const slow = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(results(ANSWER)))
        .mockReturnValue(slow.promise),
    );
    await openQuery("grace");
    const oldRow = await screen.findByRole("option", { name: "Grace Mensah" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "priya" } });
    expect(screen.queryByRole("option", { name: ANSWER.title })).toBeNull();
    expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
    expect(screen.queryByRole("option", { name: COPY.addDiver })).toBeNull();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    fireEvent.click(oldRow);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("ignores an out-of-order response even when it belongs to the same query text", async () => {
    const old = deferred<Response>();
    const current = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response(empty))
      .mockReturnValueOnce(current.promise);
    vi.stubGlobal("fetch", fetchMock);
    await openQuery("grace");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "priya" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "grace" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await act(async () => old.resolve(response(results(ANSWER))));
    expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
    await act(async () => current.resolve(response(empty)));
    await screen.findByText(COPY.emptyNoMatches, { selector: "p" });
    expect(screen.queryByRole("option", { name: ANSWER.title })).toBeNull();
  });

  it("cancels lookup on clear and close, and never restores it on reopen", async () => {
    const late = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(late.promise);
    vi.stubGlobal("fetch", fetchMock);
    await openQuery("grace");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => late.resolve(response(results(ANSWER))));
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
  });

  it.each(["HTTP 503", "network error"])(
    "distinguishes %s from empty success and retries the current query",
    async (failure) => {
      const fetchMock = vi.fn();
      if (failure === "HTTP 503")
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      else fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      fetchMock.mockResolvedValueOnce(response(empty));
      vi.stubGlobal("fetch", fetchMock);
      await openQuery("unfindable");
      await screen.findByText("Search unavailable.", { selector: "p" });
      expect(screen.queryByText(COPY.emptyNoMatches)).toBeNull();
      expect(screen.queryByRole("option", { name: COPY.addDiver })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByText(COPY.emptyNoMatches, { selector: "p" });
      expect(await screen.findByRole("option", { name: COPY.addDiver })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe("/api/search?q=unfindable");
    },
  );

  it("announces available local navigation counts while record lookup is pending", async () => {
    const lookup = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(lookup.promise));
    await openQuery("divers");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("option", { name: "divers" })).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector('[aria-live="polite"]')).toHaveTextContent(
      `${COPY.searching}, ${COPY.groupGoTo} (1)`,
    );
  });

  it("keeps local navigation usable while a request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await openQuery("divers");
    await screen.findByText(COPY.searchFailed, { selector: "p" });
    await userEvent.click(screen.getByRole("option", { name: "divers" }));
    expect(routerPush).toHaveBeenCalledWith("/shop/blue-mantis/divers");
  });

  it("ignores a cancelled response whose JSON finishes after the new query", async () => {
    const body = deferred<SearchResults>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => body.promise })
      .mockResolvedValueOnce(response(empty));
    vi.stubGlobal("fetch", fetchMock);
    await openQuery("grace");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "priya" } });
    await screen.findByText(COPY.emptyNoMatches, { selector: "p" });
    await act(async () => body.resolve(results(ANSWER)));
    expect(screen.queryByRole("option", { name: ANSWER.title })).toBeNull();
  });

  it("clears today's private rows when reading recents loses authorization", async () => {
    const recentKey = "diveday.palette.recent.blue-mantis.p-auth";
    window.localStorage.setItem(
      recentKey,
      JSON.stringify([{ key: "diver:p-grace", kind: "diver", id: "p-grace" }]),
    );
    const denied = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(denied.promise));
    renderPalette(undefined, {
      readerId: "p-auth",
      todayBoats: [{ id: "t-1", title: "Two-Tank Reef", time: "7:00 AM" }],
    });
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(screen.getByRole("option", { name: "Two-Tank Reef" })).toBeInTheDocument();
    await act(async () => denied.resolve(new Response(null, { status: 401 })));
    await screen.findByText(COPY.searchUnauthorized, { selector: "p" });
    expect(screen.queryByRole("option", { name: "Two-Tank Reef" })).toBeNull();
    expect(screen.getByRole("link", { name: COPY.signInAgain })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    window.localStorage.removeItem(recentKey);
  });

  it.each([401, 403])(
    "does not let a search started before recents authorization loss (%s) restore private data",
    async (status) => {
      const recentKey = "diveday.palette.recent.blue-mantis.p-revoked";
      window.localStorage.setItem(
        recentKey,
        JSON.stringify([{ key: "diver:p-grace", kind: "diver", id: "p-grace" }]),
      );
      const recents = deferred<Response>();
      const lookup = deferred<Response>();
      const fetchMock = vi
        .fn()
        .mockReturnValueOnce(recents.promise)
        .mockReturnValueOnce(lookup.promise);
      vi.stubGlobal("fetch", fetchMock);
      renderPalette(undefined, {
        readerId: "p-revoked",
        todayBoats: [{ id: "t-1", title: "Two-Tank Reef", time: "7:00 AM" }],
      });
      await userEvent.click(screen.getByRole("button", { name: /Search/ }));
      expect(screen.getByRole("option", { name: "Two-Tank Reef" })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "grace" } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await act(async () => recents.resolve(new Response(null, { status })));
      expect(screen.getByText(COPY.searchUnauthorized, { selector: "p" })).toBeInTheDocument();
      await act(async () => lookup.resolve(response(results(ANSWER))));
      expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
      expect(screen.queryByRole("option", { name: ANSWER.title })).toBeNull();
      expect(screen.queryByRole("option", { name: COPY.addDiver })).toBeNull();
      expect(screen.getByText(COPY.searchUnauthorized, { selector: "p" })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
      expect(screen.queryByRole("option", { name: "Two-Tank Reef" })).toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "other query" } });
      expect(screen.getByText(COPY.searchUnauthorized, { selector: "p" })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      window.localStorage.removeItem(recentKey);
    },
  );

  it("clears private data on authorization loss, including after clearing the query", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(results(ANSWER)))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await openQuery("grace");
    await screen.findByRole("option", { name: ANSWER.title });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "priya" } });
    await screen.findByText("Sign in again to search records.", { selector: "p" });
    expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
    expect(screen.queryByRole("option", { name: COPY.addDiver })).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(screen.queryByRole("option", { name: ANSWER.title })).toBeNull();
    expect(screen.queryByRole("option", { name: "Grace Mensah" })).toBeNull();
  });
});

// An explicit dismissal must use the same focus/cancellation path as Escape.
it("closes with its explicit control and returns focus to its opener", async () => {
  const user = userEvent.setup();
  renderPalette();
  const opener = screen.getByRole("button", { name: COPY.search });
  await user.click(opener);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});
