// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiverFilter } from "@/db/divers";
import { staffTranslator } from "@/i18n/staff-messages";

// The list drives the URL as you type, so it reaches for the app router. One
// shared `replace` spy, so a test can assert what the debounce did (or, for the
// regression below, that it stayed out of the way).
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/divers",
  useRouter: () => ({
    replace: (...args: unknown[]) => replace(...args),
    push: (...args: unknown[]) => push(...args),
  }),
}));

import { DiverList, type RosterRow } from "./DiverList";

afterEach(cleanup);
beforeEach(() => {
  replace.mockClear();
  push.mockClear();
});

const t = staffTranslator("en-US");

/** One live diver, so a test can tap the row the roster is made of. */
function rosterRow(overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    personId: "person-2",
    fullName: "Mira Castellanos",
    href: "/shop/blue-mantis/divers/person-2",
    letter: "M",
    badges: [],
    fact: null,
    ...overrides,
  };
}

const copy = {
  addDiverLabel: t("divers.list.addDiverAction"),
  viewAllDivers: t("divers.list.viewAllDivers"),
  viewDivingToday: t("divers.list.viewDivingToday"),
  viewNeedsAttention: t("divers.list.viewNeedsAttention"),
  viewMissingContact: t("divers.list.viewMissingContact"),
  viewRemoved: t("divers.list.viewRemoved"),
  viewsAriaLabel: t("divers.list.viewsAriaLabel"),
  removedNote: t("divers.list.removedNote"),
  countLabel: t("divers.list.pagination.total", { count: 0 }),
  searchDiversLabel: t("divers.list.searchDiversLabel"),
  searchPlaceholder: t("divers.list.searchPlaceholder"),
  noDiversMatchView: t("divers.list.noDiversMatchView"),
  noDiversOnFile: t("divers.list.noDiversOnFile"),
  addOneHere: t("divers.list.addOneHere"),
  emptyShowAll: t("divers.list.emptyShowAll"),
  emptyImportBody: t("divers.list.emptyImportBody"),
  emptyImportAction: t("divers.list.emptyImportAction"),
  letterOther: t("divers.list.letterOther"),
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
  rows = [] as RosterRow[],
  // Annotated because `total`'s default reads `rows`, and an inferred
  // parameter type that refers to a sibling parameter is circular to tsc.
  total = rows.length as number,
  // Owner/manager by default — the only staffer the Deleted view exists for.
  canRestore = true,
  quickAddAction = (() => {}) as ((formData: FormData) => void) | null,
  copyOverrides = {} as Partial<typeof copy>,
} = {}) {
  return render(
    <DiverList
      rows={rows}
      total={total}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
      importHref={importHref}
      canRestore={canRestore}
      quickAddAction={quickAddAction}
      copy={{ ...copy, ...copyOverrides }}
    />,
  );
}

describe("DiverList search", () => {
  it("opens with the search box focused, so a staffer can just start typing", () => {
    // Check-in has done this since it shipped and the roster had not, which is
    // the one difference between two pages a staffer uses for the same reason:
    // they arrive holding a name. Pinned here because the focus goes through a
    // ref (biome forbids `autoFocus`), so nothing else would fail if the ref
    // were dropped from the input in a later edit.
    renderList();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("keeps the focus on the search box when the roster arrives filtered", () => {
    renderList({ query: "nobody" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
});

describe("DiverList empty state", () => {
  /**
   * **Day one is the state with no other door.** The empty card offers a bulk
   * import and nothing else, and the page header carries no action — so before
   * this the roster of a shop with no divers had no way to add one, because
   * the only "Add diver" in the page mounted on the first keystroke of a
   * search over an empty roster.
   */
  it("offers the full add-a-diver form while the search box is empty", () => {
    renderList();
    expect(screen.getByText("No divers on file yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add diver" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new",
    );
  });

  /**
   * The caller that passes no quick-add action gets no button at all — the
   * empty-box door is the same offer through a different mechanism, not a
   * second one that outlives it.
   */
  it("offers neither door when the caller withholds the quick-add action", () => {
    renderList({ quickAddAction: null });
    expect(screen.queryByRole("link", { name: "Add diver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add diver" })).toBeNull();
  });

  it("offers a bulk import to whoever may run one", () => {
    renderList();
    expect(screen.getByRole("link", { name: "Import your roster" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings/import",
    );
  });

  it("hides the import door from whoever may not — no disabled control, no explanation", () => {
    renderList({ importHref: null });
    expect(screen.queryByRole("link", { name: "Import your roster" })).toBeNull();
    expect(screen.queryByText(/spreadsheet/i)).toBeNull();
  });

  it("offers the way back out or to add the typed diver when search narrowed to nothing", () => {
    renderList({ query: "nobody" });
    expect(screen.getByText("No divers match this view.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add diver" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all divers" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers",
    );
  });

  /**
   * Nothing to group when there is nothing to list — no stray letter labels.
   *
   * Targeted at the letter heads by their own id rather than at every `h2` on
   * the page: the empty state's title *is* an `h2` and should be, so a bare
   * count of headings asserts the opposite of what this test is named for.
   */
  it("renders no letter groups over an empty roster", () => {
    const { container } = renderList();
    expect(container.querySelectorAll("[id^='roster-letter-']")).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();
    // The one heading that should be there, so this cannot pass by rendering
    // nothing at all.
    expect(screen.getByRole("heading", { name: "No divers on file yet." })).toBeInTheDocument();
  });

  /**
   * **Clearing the box swaps the door, and moves nothing.**
   *
   * The button used to unmount on an exit animation while the search box slid
   * back across the row to reclaim the space (issue #782, and on a phone
   * #781). Both doors carry the same words at the same size, so the only way
   * to see the swap is to read the element — which is what this does, in both
   * directions.
   */
  it("swaps the quick-add for the full form when the search is cleared, without moving either", () => {
    renderList({ query: "nobody" });
    const search = screen.getByRole("searchbox", { name: "Search divers" });
    expect(screen.getByRole("button", { name: "Add diver" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Add diver" })).toBeNull();
    expect(screen.getByRole("link", { name: "Add diver" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new",
    );

    fireEvent.change(search, { target: { value: "Nora" } });
    expect(screen.queryByRole("link", { name: "Add diver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add diver" })).toBeInTheDocument();
  });

  /**
   * **The motion is gone from the row, not merely quiet on a phone.**
   *
   * `.animate-slide-in-right` / `.animate-slide-out-right` slid the search box
   * sideways to make room for a button that mounted on the first keystroke.
   * The phone half was answered by an `@media (width < 40rem)` block that cut
   * the duration to `0.01ms` — necessarily a duration rather than
   * `animation: none`, because the component's state machine only advanced on
   * `animationend`. With the button rendered from first paint there is no
   * reveal to animate, no state machine to strand, and no reason to keep a
   * breakpoint that made one layout behave unlike the other.
   *
   * Read out of the stylesheet as well as the DOM: a class left behind in
   * `globals.css` is what a later edit reaches for and re-applies.
   */
  it("leaves no horizontal travel on the search row, in the markup or the stylesheet", () => {
    const { container } = renderList({ query: "" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search divers" }), {
      target: { value: "Nora" },
    });
    expect(container.querySelectorAll("[class*='animate-slide']")).toHaveLength(0);

    // Comments stripped first: the block left where these rules stood names
    // every one of them, which is the point of leaving it there.
    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "globals.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toContain("animate-slide-in-right");
    expect(css).not.toContain("animate-slide-out-right");
    expect(css).not.toContain("--quick-add-shift");
    expect(css).not.toContain("@media (width < 40rem)");
  });

  it("treats a built-in view chip as narrowing too, not as an empty roster", () => {
    renderList({ filter: "needs_attention" });
    expect(screen.getByText("No divers match this view.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all divers" })).toBeInTheDocument();
  });
});

/**
 * **The roster is one ledger** (ADR 20260827-people-not-lists, decision 2).
 * These are the rules that decision states about a row, each asserted for
 * absence as hard as for presence — the design is mostly what a row no longer
 * carries.
 */
describe("DiverList ledger", () => {
  const roster: RosterRow[] = [
    rosterRow({
      personId: "aasen",
      fullName: "Bjorn Aasen",
      href: "/shop/blue-mantis/divers/aasen",
      letter: "A",
      fact: "last aboard Wed, Aug 26",
    }),
    rosterRow({
      personId: "alvarez",
      fullName: "Diego Alvarez",
      href: "/shop/blue-mantis/divers/alvarez",
      letter: "A",
      badges: [{ tone: "warning", label: "Open balance" }],
      fact: "booked Thu, Aug 27 · 7:30 PM",
    }),
    rosterRow({
      personId: "mensah",
      fullName: "Grace Mensah",
      href: "/shop/blue-mantis/divers/mensah",
      letter: "M",
      badges: [{ tone: "danger", label: "Blocked — certification" }],
      fact: "booked Thu, Aug 27 · 7:00 AM",
    }),
  ];

  /**
   * **The slice's pin.** A diver with nothing outstanding wears no pill at all
   * — not "Certified", not "Ready", not a level. The roster used to badge
   * every row of the "Needs attention" view with the very count that view is
   * *made* of, which is the same fact at two volumes (principle 9).
   */
  it("carries no badge on a clear diver's row", () => {
    const { container } = renderList({ rows: [rosterRow({ fact: "last aboard Wed, Aug 26" })] });
    const row = container.querySelector("li");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Mira Castellanos");
    expect(row?.textContent).toContain("last aboard Wed, Aug 26");
    // `rounded-full` is the badge's own shape and the app's only pill. Scoped
    // to the ledger, because the view chips above it wear the same shape for a
    // different job: if a badge ever comes back for an expected state, this is
    // where it lands first.
    expect(screen.getByRole("list").querySelectorAll(".rounded-full")).toHaveLength(0);
  });

  it("badges the exceptional states, and every one of them carries a word", () => {
    renderList({ rows: roster });
    expect(screen.getByText("Open balance")).toBeInTheDocument();
    expect(screen.getByText("Blocked — certification")).toBeInTheDocument();
    // Two rows carry one badge each; the third carries none.
    expect(screen.getAllByText(/Open balance|Blocked — certification/)).toHaveLength(2);
  });

  /**
   * **The letter is the group's, not the row's.** A shared fact belongs to the
   * header once (ADR 20260827-clearwater-surface-language, decision 2), and
   * the groups come out of the query's own order rather than being re-sorted
   * here — see `groupByLetter` in `src/lib/roster-rows.ts`.
   */
  it("heads each run of names with its letter, once", () => {
    const { container } = renderList({ rows: roster });
    const labels = [...container.querySelectorAll("h2")];
    expect(labels.map((node) => node.textContent)).toEqual(["A", "M"]);
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[0]?.querySelectorAll("li")).toHaveLength(2);
    expect(lists[1]?.querySelectorAll("li")).toHaveLength(1);
    // Each list is named by the label above it, so a screen reader hears the
    // letter before the names under it.
    expect(lists[0]?.getAttribute("aria-labelledby")).toBe(labels[0]?.id);
  });

  it("groups the names that begin with no letter under their own label", () => {
    const { container } = renderList({
      rows: [rosterRow({ personId: "mate", fullName: "1st Mate", letter: null })],
    });
    expect(container.querySelector("h2")?.textContent).toBe("#");
  });

  /**
   * **One rendering at every width.** The roster used to draw a phone card
   * list and a desktop table over the same page of divers, so every assertion
   * about it had to say which copy it meant and every diver's name existed
   * twice in the DOM.
   */
  it("renders each diver exactly once, with the row as the door", () => {
    const { container } = renderList({ rows: roster });
    expect(container.querySelectorAll("table")).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Bjorn Aasen" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Bjorn Aasen" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/aasen",
    );
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  /**
   * The count is a fact about the list, not a status: quiet text beside the
   * search box. It used to be a `Badge` hanging off a "People" heading that
   * named the thing the page is already called.
   */
  it("states the count quietly beside the search box, wearing no pill", () => {
    renderList({
      rows: [rosterRow()],
      total: 312,
      copyOverrides: { countLabel: "312 divers" },
    });
    const count = screen.getByText("312 divers");
    expect(count.closest(".rounded-full")).toBeNull();
    expect(screen.queryByRole("heading", { name: /People/ })).toBeNull();
  });

  /** One match and Enter goes straight to the record — the counter's fast path. */
  it("opens the only match on Enter", () => {
    renderList({ rows: [rosterRow()], total: 1, query: "Mira" });
    const input = screen.getByRole("searchbox", { name: "Search divers" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/shop/blue-mantis/divers/person-2");
  });
});

describe("DiverList roster views", () => {
  it("hides the view chips over a day-one empty roster — controls with nothing to govern", () => {
    renderList();
    expect(screen.queryByRole("navigation", { name: "Roster views" })).toBeNull();
    // Narrowed-to-nothing is a different state: the chips are how you widen
    // back out, so the row stays.
    cleanup();
    renderList({ filter: "missing_contact" });
    expect(screen.getByRole("navigation", { name: "Roster views" })).toBeInTheDocument();
  });

  it("offers the day's three questions over the roster, then the way back to a removal", () => {
    // A view chip is active so the row renders (the roster itself is empty in
    // this fixture; see the day-one test above for the hidden state).
    renderList({ filter: "diving_today" });
    const views = screen.getByRole("navigation", { name: "Roster views" });
    expect(
      [...views.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["All divers", "/shop/blue-mantis/divers"],
      ["Diving today", "/shop/blue-mantis/divers?filter=diving_today"],
      ["Needs attention", "/shop/blue-mantis/divers?filter=needs_attention"],
      ["Missing contact", "/shop/blue-mantis/divers?filter=missing_contact"],
      // Last, and apart from the three: not a question about today, but the
      // only way to find a diver somebody removed.
      ["Deleted", "/shop/blue-mantis/divers?filter=removed"],
    ]);
    // The per-browser saved views are gone entirely — no button, no chips.
    expect(screen.queryByRole("button", { name: /save this view/i })).toBeNull();
  });

  it("hides the Deleted view from a staffer who may not restore — no chip, no explanation", () => {
    renderList({ filter: "diving_today", canRestore: false });
    const views = screen.getByRole("navigation", { name: "Roster views" });
    expect([...views.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "All divers",
      "Diving today",
      "Needs attention",
      "Missing contact",
    ]);
  });
});

describe("DiverList removed view", () => {
  const removedRows: RosterRow[] = [
    rosterRow({
      personId: "person-1",
      fullName: "Deleted Alex",
      href: "/shop/blue-mantis/divers/person-1",
      letter: "A",
    }),
  ];

  /**
   * **The shared fact is stated once, where the count would be.** Every row in
   * this view is removed, so a "Removed" pill down each of them would be that
   * one fact at row volume (ADR 20260827-clearwater-surface-language: a shared
   * fact belongs to the header, never repeated down rows at equal weight).
   * What the rows cannot say for themselves is what removal *means*, and that
   * is the line.
   */
  it("says what removal means, rather than looking like the ordinary roster", () => {
    renderList({ filter: "removed", rows: removedRows });
    expect(screen.getByText(/off every list and out of trip prep/i)).toBeInTheDocument();
    // Not the count line, and not a badge on the row either.
    expect(screen.queryByText(/^\d+ divers?$/)).toBeNull();
    expect(screen.getByRole("list").querySelectorAll(".rounded-full")).toHaveLength(0);
  });

  it("still links the row through to the diver record, which now resolves for them", () => {
    renderList({ filter: "removed", rows: removedRows });
    expect(screen.getByRole("link", { name: "Deleted Alex" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
  });

  /**
   * **A row is a link, and nothing else.**
   *
   * The Deleted view used to hang a "Restore" off every row, which put a
   * consequential write on a list a staffer *scans* — one mis-tap away from a
   * name they were only looking for, and with none of the record's context on
   * screen. Every action on a diver now lives on that diver's record, where
   * `RestoreDiver` states the deleted state directly above the button.
   *
   * Asserted on the Deleted view because that is where the last row action
   * lived: if one ever comes back, this is the row it comes back on.
   */
  it("carries no buttons and no forms on a row — not even a restore", () => {
    renderList({ filter: "removed", rows: removedRows });
    const list = screen.getByRole("list");
    expect(list.querySelectorAll("button")).toHaveLength(0);
    expect(list.querySelectorAll("form")).toHaveLength(0);
  });

  it("keeps the search on when a view chip is followed", () => {
    renderList({ query: "nadia" });
    expect(screen.getByRole("link", { name: "Needs attention" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers?q=nadia&filter=needs_attention",
    );
  });

  /**
   * The race this exists for: a keystroke sitting in the 250ms debounce was
   * scheduled against the view on screen when it was pressed, so letting it
   * land after a chip tap replaces the URL with the view just left. Asserted
   * with fake timers because the failure is a *late* navigation, not a missing
   * one.
   */
  it("does not let a pending search undo a view chip tapped inside the debounce window", () => {
    vi.useFakeTimers();
    try {
      renderList({ filter: "diving_today" });
      const input = screen.getByRole("searchbox", { name: "Search divers" });
      fireEvent.change(input, { target: { value: "priya" } });
      fireEvent.click(screen.getByRole("link", { name: "Needs attention" }));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The same race on the rows, which are the only links a staffer uses on the
   * way to somewhere. Reproduced in e2e/certifications.spec.ts, which could
   * not reach a diver's record at all once the machine was loaded enough for
   * the click to beat the timer. The cancel now rides a capture-phase handler
   * on the ledger rather than an `onClick` per row — `LedgerRow`'s stretched
   * door takes no handler — so this test is also what pins that wiring.
   */
  it("does not let a pending search undo a diver row tapped inside the debounce window", () => {
    vi.useFakeTimers();
    try {
      renderList({ rows: [rosterRow()] });
      const input = screen.getByRole("searchbox", { name: "Search divers" });

      // Type a name; the row for it is already rendered, so the staffer can
      // reach it without waiting for the search to commit.
      fireEvent.change(input, { target: { value: "Mira" } });
      const row = screen.getByRole("link", { name: "Mira Castellanos" });
      expect(row).toHaveAttribute("href", "/shop/blue-mantis/divers/person-2");
      fireEvent.click(row);

      // The record owns this navigation now. A replace landing behind it is
      // the staffer's tap being silently undone.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The other half of the race above: after a search commits to the URL, the
   * server render for it can land *after* the staffer has already cleared the
   * box. The prop-sync effect used to restore that stale query into the input
   * unconditionally — and since the chips build their hrefs from the box, the
   * next chip tap carried the resurrected search back into the URL (the
   * "All divers" chip landing on `?q=…` in e2e/roster-views.spec.ts).
   * Mid-debounce, the staffer's keystrokes win over any late render.
   */
  it("does not resurrect a cleared search when the previous search's render lands late", () => {
    vi.useFakeTimers();
    try {
      const props = {
        rows: [],
        total: 0,
        shopSlug: "blue-mantis",
        filter: "needs_attention" as DiverFilter,
        importHref: null,
        canRestore: false,
        copy,
      };
      const view = render(<DiverList {...props} query="" />);
      const input = screen.getByRole("searchbox", { name: "Search divers" });

      // The staffer searches; the debounce fires and commits `?q=mateo` to
      // the URL. The server render for it is now in flight.
      fireEvent.change(input, { target: { value: "mateo" } });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(replace).toHaveBeenCalledTimes(1);

      // They clear the box before that render arrives — and then it lands,
      // as a prop change carrying the search they just abandoned.
      fireEvent.change(input, { target: { value: "" } });
      view.rerender(<DiverList {...props} query="mateo" />);

      expect(input).toHaveValue("");
      expect(screen.getByRole("link", { name: "All divers" })).toHaveAttribute(
        "href",
        "/shop/blue-mantis/divers",
      );

      // Once the pending clear lands, the sync is welcome again.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      view.rerender(<DiverList {...props} query="nadia" />);
      expect(input).toHaveValue("nadia");
    } finally {
      vi.useRealTimers();
    }
  });
});
