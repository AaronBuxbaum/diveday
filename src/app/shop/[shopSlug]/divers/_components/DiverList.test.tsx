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
  addDiverWithName: t.raw("divers.list.addDiverWithName"),
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
  it("does not offer a separate add diver button before typing", () => {
    renderList();
    expect(screen.getByText("No divers on file yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add diver" })).toBeNull();
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

  it("slides the add diver action away when the search is cleared", () => {
    vi.useFakeTimers();
    try {
      renderList({ query: "nobody" });
      const search = screen.getByRole("searchbox", { name: "Search divers" });
      fireEvent.change(search, { target: { value: "" } });
      const button = screen.getByRole("button", { name: "Add diver" });
      const animationShell = button.closest("div");
      expect(animationShell).toHaveClass("animate-slide-out-right");

      fireEvent.animationEnd(animationShell as HTMLElement, { animationName: "slide-out-right" });
      act(() => vi.advanceTimersByTime(250));
      expect(screen.queryByRole("button", { name: "Add diver" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **The phone gets no horizontal travel, and still gets the event.**
   *
   * The slide was designed for the desktop layout, where the input is a fixed
   * 20rem beside the button and the motion reads as the button pushing it
   * aside. Below `sm` the input is full width in a clipped row, so the same
   * 250ms carried the whole focused search box across the screen while
   * somebody was typing into it (issue #781).
   *
   * The trap is that `animationend` is the *only* thing that advances
   * `entering -> visible`: drop the animation below `sm` and the button is
   * stranded mid-state forever. So the rule collapses the *duration* instead —
   * the shape the reduced-motion kill-switch already uses — and this asserts
   * exactly that, because a component test cannot see a media query.
   *
   * It cannot assert the settle: **jsdom implements no `AnimationEvent`**, so
   * nothing here can fire the event React is listening for. `e2e/divers.spec.ts`
   * does it in a real browser at a phone viewport instead.
   */
  it("keeps the animation classes, and collapses the motion rather than removing it on a phone", () => {
    renderList({ query: "" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search divers" }), {
      target: { value: "Nora" },
    });
    // There has to be an animation for `animationend` to end.
    expect(screen.getByRole("button", { name: /Add/ }).closest("div")).toHaveClass(
      "animate-slide-in-right",
    );

    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "globals.css"),
      "utf8",
    );
    const phoneRule = css.slice(css.indexOf("@media (width < 40rem)"));
    const body = phoneRule.slice(0, phoneRule.indexOf("\n}"));
    expect(body).toContain(".animate-slide-in-right");
    expect(body).toContain(".animate-slide-out-right");
    expect(body).toContain("animation-duration: 0.01ms");
    // Never `animation: none` — see the state machine above.
    expect(body).not.toContain("animation: none");
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
