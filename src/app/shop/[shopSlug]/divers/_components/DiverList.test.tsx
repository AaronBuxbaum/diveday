// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiverFilter, listDiverSummaries } from "@/db/divers";
import { staffTranslator } from "@/i18n/staff-messages";

// The list drives the URL as you type, so it reaches for the app router. One
// shared `replace` spy, so a test can assert what the debounce did (or, for the
// regression below, that it stayed out of the way).
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/divers",
  useRouter: () => ({ replace: (...args: unknown[]) => replace(...args), push: vi.fn() }),
}));

import { DiverList } from "./DiverList";

afterEach(cleanup);
beforeEach(() => replace.mockClear());

const t = staffTranslator("en-US");

type DiverPage = Awaited<ReturnType<typeof listDiverSummaries>>;

const emptyPage: DiverPage = { divers: [], total: 0, page: 1, pageCount: 0, pageSize: 25 };

/** One live diver, so a test can tap the row link the roster is made of. */
const rosterPage: DiverPage = {
  ...emptyPage,
  total: 1,
  pageCount: 1,
  divers: [
    {
      person: {
        id: "person-2",
        fullName: "Mira Castellanos",
        email: "mira@example.com",
        phone: null,
        deletedAt: null,
      },
      certificationLevel: null,
      certificationCount: 0,
      pendingCertificationCount: 0,
      specialtyCount: 0,
      pendingSpecialtyOrNitroxCount: 0,
      importedUnconfirmedCount: 0,
      nitroxCertificationCount: 0,
      rentalFit: null,
    } as unknown as DiverPage["divers"][number],
  ],
};

const copy = {
  addDiverLabel: t("divers.list.addDiverAction"),
  viewAllDivers: t("divers.list.viewAllDivers"),
  viewDivingToday: t("divers.list.viewDivingToday"),
  viewNeedsAttention: t("divers.list.viewNeedsAttention"),
  viewMissingContact: t("divers.list.viewMissingContact"),
  viewRemoved: t("divers.list.viewRemoved"),
  viewsAriaLabel: t("divers.list.viewsAriaLabel"),
  removedNote: t("divers.list.removedNote"),
  peopleHeading: t("divers.list.peopleHeading"),
  peopleCountLabel: t("divers.page.onFileCount", { count: 0 }),
  searchHintText: t("divers.list.searchHintText"),
  searchDiversLabel: t("divers.list.searchDiversLabel"),
  searchPlaceholder: t("divers.list.searchPlaceholder"),
  noDiversMatchView: t("divers.list.noDiversMatchView"),
  noDiversOnFile: t("divers.list.noDiversOnFile"),
  addOneHere: t("divers.list.addOneHere"),
  emptyShowAll: t("divers.list.emptyShowAll"),
  emptyImportBody: t("divers.list.emptyImportBody"),
  emptyImportAction: t("divers.list.emptyImportAction"),
  noContactDetails: t("divers.list.noContactDetails"),
  certificationLevels: {
    open_water: t("shared.readiness.certificationLevels.openWater"),
    advanced_open_water: t("shared.readiness.certificationLevels.advancedOpenWater"),
    rescue: t("shared.readiness.certificationLevels.rescue"),
    divemaster: t("shared.readiness.certificationLevels.divemaster"),
    instructor: t("shared.readiness.certificationLevels.instructor"),
  },
  noCertificationLevel: t("divers.list.noCertificationLevel"),
  pendingReviewText: t.raw("divers.list.pendingReviewText"),
  toConfirmText: t.raw("divers.list.toConfirmText"),
  tableHeaderPerson: t("divers.list.tableHeaderPerson"),
  tableHeaderLevel: t("divers.list.tableHeaderLevel"),
  tableHeaderAttention: t("divers.list.tableHeaderAttention"),
  possibleDuplicateLabel: t("divers.list.possibleDuplicateLabel"),
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
  page = emptyPage,
  // Owner/manager by default — the only staffer the Deleted view exists for.
  canRestore = true,
  quickAddAction = (() => {}) as ((formData: FormData) => void) | null,
  copyOverrides = {} as Partial<typeof copy>,
} = {}) {
  return render(
    <DiverList
      page={page}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
      possibleDuplicateIds={[]}
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

  it("keeps the search hint visible after the query reaches the URL", () => {
    renderList({ query: "nobody" });
    expect(screen.getByText("Search by name, email, or phone.")).toBeInTheDocument();
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

/**
 * Removal was reversible in the data from the start, but nothing in the UI
 * could *find* a removed diver once the undo toast was gone: they matched no
 * search and sat in no view. This is the view that puts them back within reach.
 *
 * The restore itself is **not** here any more — see the row-actions block
 * below. This view's job is finding the person; putting them back is a decision
 * taken on their own record, with the record in front of you.
 */
describe("DiverList removed view", () => {
  const removedPage: DiverPage = {
    ...emptyPage,
    total: 1,
    pageCount: 1,
    divers: [
      {
        person: {
          id: "person-1",
          fullName: "Deleted Alex",
          email: "alex@example.com",
          phone: null,
          deletedAt: new Date("2026-08-01T00:00:00Z"),
        },
        certificationLevel: null,
        certificationCount: 0,
        pendingCertificationCount: 0,
        specialtyCount: 0,
        pendingSpecialtyOrNitroxCount: 0,
        importedUnconfirmedCount: 0,
        nitroxCertificationCount: 0,
        rentalFit: null,
        // The row only renders name, contact, and counts; the rest of the
        // person row is deliberately not modelled in a render test.
      } as unknown as DiverPage["divers"][number],
    ],
  };

  it("says what removal means, rather than looking like the ordinary roster", () => {
    renderList({ filter: "removed", page: removedPage });
    expect(screen.getByText(/off every list and out of trip prep/i)).toBeInTheDocument();
    // The generic search hint would be the wrong thing to say here.
    expect(screen.queryByText("Search by name, email, or phone.")).toBeNull();
  });

  it("still links the row through to the diver record, which now resolves for them", () => {
    renderList({ filter: "removed", page: removedPage });
    for (const link of screen.getAllByRole("link", { name: /Deleted Alex/ })) {
      expect(link).toHaveAttribute("href", "/shop/blue-mantis/divers/person-1");
    }
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
    renderList({ filter: "removed", page: removedPage });
    const list = screen.getByRole("list");
    const table = screen.getByRole("table");
    for (const rows of [list, table]) {
      expect(rows.querySelectorAll("button")).toHaveLength(0);
      expect(rows.querySelectorAll("form")).toHaveLength(0);
    }
  });

  it("keeps the search on when a view chip is followed", () => {
    renderList({ query: "nadia" });
    expect(screen.getByRole("link", { name: "Needs attention" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers?q=nadia&filter=needs_attention",
    );
  });

  /**
   * Regression: the search box drives the URL through a 250ms debounce, and the
   * timer used to capture the filter that was on screen when the key was
   * pressed. Tapping a view chip inside that window let the late timer replace
   * the URL with the *previous* view — silently undoing the tap, and then
   * running the next search under a view the staffer had already left.
   * Reproduced in e2e/roster-views.spec.ts as an intermittent failure.
   */
  it("does not let a pending search undo a view chip tapped inside the debounce window", () => {
    vi.useFakeTimers();
    try {
      renderList({ query: "amara", filter: "diving_today" });
      const input = screen.getByRole("searchbox", { name: "Search divers" });

      // Clear the box, then tap a chip before the debounce has fired.
      fireEvent.change(input, { target: { value: "" } });
      const chip = screen.getByRole("link", { name: "Needs attention" });
      // The chip carries what is *in the box*, not the last committed query —
      // otherwise it would re-apply the search the staffer just cleared.
      expect(chip).toHaveAttribute("href", "/shop/blue-mantis/divers?filter=needs_attention");
      fireEvent.click(chip);

      // Let the old debounce window elapse. The chip's href owns this
      // navigation now; nothing may replace the URL behind it.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Regression: the same race as the chip above, on the link a staffer actually
   * uses. The roster already shows every diver, so a name typed into the box
   * matches a row that is *on screen before the debounce fires*. Tapping it
   * opened the record and then, 250ms later, the late timer replaced the URL
   * with `?q=<name>` — putting the staffer back on the list they had just left,
   * with no sign anything had happened.
   *
   * The chips, the empty-state "show all" link and the quick-add form all
   * cancelled the pending timer; the two row links were the ones missed, and
   * they are the only ones a staffer uses on the way to somewhere. Reproduced
   * in e2e/certifications.spec.ts, which could not reach a diver's record at
   * all once the machine was loaded enough for the click to beat the timer.
   */
  it("does not let a pending search undo a diver row tapped inside the debounce window", () => {
    vi.useFakeTimers();
    try {
      renderList({ page: rosterPage });
      const input = screen.getByRole("searchbox", { name: "Search divers" });

      // Type a name; the row for it is already rendered, so the staffer can
      // reach it without waiting for the search to commit.
      fireEvent.change(input, { target: { value: "Mira" } });
      const row = screen.getAllByRole("link", { name: /Mira Castellanos/ })[0];
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
        page: emptyPage,
        shopSlug: "blue-mantis",
        filter: "needs_attention" as DiverFilter,
        possibleDuplicateIds: [],
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

  it("hangs the count off the People heading, with the noun a screen reader needs", () => {
    renderList({
      page: { ...emptyPage, total: 12 },
      copyOverrides: { peopleCountLabel: "12 divers on file" },
    });
    const heading = screen.getByRole("heading", { name: /People/ });
    expect(heading).toHaveTextContent("12");
    expect(screen.getByText("12 divers on file")).toBeInTheDocument();
  });
});

/**
 * The Cards column carried a card *count* whose value was `1` on nearly every
 * row. It now carries the fact staff actually ask for at booking time — the
 * diver's level — worded from the shop's one level vocabulary and computed
 * server-side (`certificationLevel`, src/db/divers.ts). The badges beside it
 * are unchanged: they still appear only when a row needs a staffer.
 */
describe("DiverList level cell", () => {
  function rosterPage(diver: {
    certificationLevel: string | null;
    pendingCertificationCount?: number;
    pendingSpecialtyOrNitroxCount?: number;
    importedUnconfirmedCount?: number;
  }): DiverPage {
    return {
      ...emptyPage,
      total: 1,
      pageCount: 1,
      divers: [
        {
          person: {
            id: "person-1",
            fullName: "Nadia Okafor",
            email: "nadia@example.com",
            phone: null,
            deletedAt: null,
          },
          certificationCount: 1,
          pendingCertificationCount: 0,
          specialtyCount: 0,
          pendingSpecialtyOrNitroxCount: 0,
          importedUnconfirmedCount: 0,
          nitroxCertificationCount: 0,
          rentalFit: null,
          ...diver,
        } as unknown as DiverPage["divers"][number],
      ],
    };
  }

  it("heads the column with the level, and names it in the shop's own level words", () => {
    renderList({ page: rosterPage({ certificationLevel: "advanced_open_water" }) });
    expect(screen.getByRole("columnheader", { name: "Level" })).toBeInTheDocument();
    // Once per layout: the phone card and the table row both render.
    expect(screen.getAllByText("Advanced Open Water").length).toBeGreaterThan(0);
    // The count it replaced is gone from the row entirely.
    expect(screen.queryByText("1 card")).toBeNull();
  });

  it("says so in words when no certification record speaks for this diver", () => {
    renderList({ page: rosterPage({ certificationLevel: null }) });
    expect(screen.getAllByText("No current certification").length).toBeGreaterThan(0);
  });

  /**
   * **The exception reads louder than the repetition** (issue #764). A shop
   * scanning this column is looking for the diver who has no card, and until
   * this the two rendered in the same muted grey — so the one row that matters
   * looked exactly like the "Open Water" repeated above and below it. Asserted
   * on the class rather than through a screenshot because it is a *relative*
   * claim: what matters is that the two differ, in both layouts.
   */
  it("renders a missing certification in fuller ink than a level a diver holds", () => {
    renderList({ page: rosterPage({ certificationLevel: null }) });
    for (const cell of screen.getAllByText("No current certification")) {
      expect(cell).toHaveClass("font-medium");
      expect(cell).not.toHaveClass("text-muted");
    }

    cleanup();
    renderList({ page: rosterPage({ certificationLevel: "open_water" }) });
    for (const cell of screen.getAllByText("Open Water")) {
      expect(cell).toHaveClass("text-muted");
      expect(cell).not.toHaveClass("font-medium");
    }
  });

  it("keeps the pending and to-confirm badges beside the level", () => {
    renderList({
      page: rosterPage({
        certificationLevel: "open_water",
        pendingCertificationCount: 1,
        pendingSpecialtyOrNitroxCount: 1,
        importedUnconfirmedCount: 2,
      }),
    });
    expect(screen.getAllByText("2 pending review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 to confirm").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open Water").length).toBeGreaterThan(0);
  });

  /**
   * A card awaiting review is not a level: the diver's *verified* card is what
   * the cell names, with the pending one raising its badge beside it. The rule
   * itself is pinned in src/db/divers.test.ts; this is the render half.
   */
  it("shows the verified level, not the pending one, when both are on file", () => {
    renderList({
      page: rosterPage({ certificationLevel: "open_water", pendingCertificationCount: 1 }),
    });
    expect(screen.getAllByText("Open Water").length).toBeGreaterThan(0);
    expect(screen.queryByText("Divemaster")).toBeNull();
  });
});
