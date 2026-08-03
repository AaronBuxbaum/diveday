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
  viewsAriaLabel: t("divers.list.viewsAriaLabel"),
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
  cardCountOne: t("divers.list.cardCountOne"),
  cardCountOther: t("divers.list.cardCountOther"),
  pendingReviewText: t("divers.list.pendingReviewText"),
  toConfirmText: t("divers.list.toConfirmText"),
  noneText: t("divers.list.noneText"),
  tableHeaderPerson: t("divers.list.tableHeaderPerson"),
  tableHeaderCards: t("divers.list.tableHeaderCards"),
  tableHeaderAttention: t("divers.list.tableHeaderAttention"),
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
  page = emptyPage,
  copyOverrides = {} as Partial<typeof copy>,
} = {}) {
  return render(
    <DiverList
      page={page}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
      locale="en-US"
      importHref={importHref}
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

  it("offers the day's three questions over the roster, and nothing to pin", () => {
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
    ]);
    // The per-browser saved views are gone entirely — no button, no chips.
    expect(screen.queryByRole("button", { name: /save this view/i })).toBeNull();
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
