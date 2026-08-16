// @vitest-environment jsdom
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

const copy = {
  viewAllDivers: t("divers.list.viewAllDivers"),
  viewDivingToday: t("divers.list.viewDivingToday"),
  viewNeedsAttention: t("divers.list.viewNeedsAttention"),
  viewMissingContact: t("divers.list.viewMissingContact"),
  viewRemoved: t("divers.list.viewRemoved"),
  viewsAriaLabel: t("divers.list.viewsAriaLabel"),
  removedNote: t("divers.list.removedNote"),
  restore: t("divers.list.restore"),
  restoring: t("divers.list.restoring"),
  restoreDiverLabel: t.raw("divers.list.restoreDiverLabel"),
  peopleHeading: t("divers.list.peopleHeading"),
  peopleCountLabel: t("divers.page.onFileCount", { count: 0 }),
  searchHintText: t("divers.list.searchHintText"),
  searchDiversLabel: t("divers.list.searchDiversLabel"),
  searchPlaceholder: t("divers.list.searchPlaceholder"),
  noDiversMatchView: t("divers.list.noDiversMatchView"),
  noDiversOnFile: t("divers.list.noDiversOnFile"),
  tryDifferentSearch: t("divers.list.tryDifferentSearch"),
  addOneHere: t("divers.list.addOneHere"),
  emptyAddAction: t("divers.list.emptyAddAction"),
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
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
  page = emptyPage,
  // Owner/manager by default — the roster hands this down only to whoever may
  // unarchive, and it is what makes the Archived view exist at all.
  restoreAction = (() => {}) as ((formData: FormData) => void) | null,
  copyOverrides = {} as Partial<typeof copy>,
} = {}) {
  return render(
    <DiverList
      page={page}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
      importHref={importHref}
      restoreAction={restoreAction}
      copy={{ ...copy, ...copyOverrides }}
    />,
  );
}

describe("DiverList empty state", () => {
  it("offers the add-diver form as an action, not as prose", () => {
    renderList();
    expect(screen.getByText("No divers on file yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first diver" })).toBeInTheDocument();
  });

  it("opens the collapsed add-diver disclosure and focuses its first field", async () => {
    const details = document.createElement("details");
    details.id = "add-diver";
    details.innerHTML = '<input name="fullName" />';
    document.body.append(details);
    // jsdom has no layout, so scrollIntoView is not implemented on elements.
    details.scrollIntoView = vi.fn();

    renderList();
    expect(details.open).toBe(false);
    screen.getByRole("button", { name: "Add your first diver" }).click();

    expect(details.open).toBe(true);
    expect(details.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(details.querySelector('input[name="fullName"]'));
    details.remove();
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

  it("offers the way back out when a search or view narrowed the list to nothing", () => {
    renderList({ query: "nobody" });
    expect(screen.getByText("No divers match this view.")).toBeInTheDocument();
    // Widening the view is the fix here; adding a diver is not.
    expect(screen.getByRole("link", { name: "Show all divers" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers",
    );
    expect(screen.queryByRole("button", { name: "Add your first diver" })).toBeNull();
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
      ["Archived", "/shop/blue-mantis/divers?filter=removed"],
    ]);
    // The per-browser saved views are gone entirely — no button, no chips.
    expect(screen.queryByRole("button", { name: /save this view/i })).toBeNull();
  });

  it("hides the Archived view from a staffer who may not unarchive — no chip, no explanation", () => {
    renderList({ filter: "diving_today", restoreAction: null });
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
 * search and sat in no view. This is the view that puts them back within reach,
 * and a restore that works tomorrow rather than for twelve seconds.
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
          fullName: "Archived Alex",
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

  it("puts a restore on each row, named for the diver it restores", () => {
    renderList({ filter: "removed", page: removedPage });
    // One per layout (the phone cards and the table both render), each
    // distinctly named so a screen reader is never offered two bare "Unarchive"s.
    const buttons = screen.getAllByRole("button", { name: "Unarchive Archived Alex" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const form = button.closest("form");
      expect(form?.querySelector('input[name="personId"]')).toHaveValue("person-1");
    }
  });

  it("still links the row through to the diver record, which now resolves for them", () => {
    renderList({ filter: "removed", page: removedPage });
    for (const link of screen.getAllByRole("link", { name: /Archived Alex/ })) {
      expect(link).toHaveAttribute("href", "/shop/blue-mantis/divers/person-1");
    }
  });

  it("offers no restore to a staffer who may not restore", () => {
    renderList({ filter: "removed", page: removedPage, restoreAction: null });
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
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
        restoreAction: null,
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
