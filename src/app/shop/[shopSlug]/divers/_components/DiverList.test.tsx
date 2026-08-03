// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverFilter, listDiverSummaries } from "@/db/divers";
import { staffTranslator } from "@/i18n/staff-messages";

// The list drives the URL as you type, so it reaches for the app router. Its
// empty state does not navigate — these stubs are only what makes the module
// renderable outside a Next request.
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/divers",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { DiverList } from "./DiverList";

afterEach(cleanup);

const t = staffTranslator("en-US");

type DiverPage = Awaited<ReturnType<typeof listDiverSummaries>>;

const emptyPage: DiverPage = { divers: [], nextCursor: null, total: 0 };

const copy = {
  viewAllDivers: t("divers.list.viewAllDivers"),
  viewMissingContact: t("divers.list.viewMissingContact"),
  viewInsured: t("divers.list.viewInsured"),
  savedViewsAriaLabel: t("divers.list.savedViewsAriaLabel"),
  namePromptText: t("divers.list.namePromptText"),
  removeSavedViewAriaLabel: t("divers.list.removeSavedViewAriaLabel"),
  saveThisView: t("divers.list.saveThisView"),
  peopleHeading: t("divers.list.peopleHeading"),
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
  showMoreDivers: t("divers.list.showMoreDivers"),
  backToTop: t("divers.list.backToTop"),
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
} = {}) {
  return render(
    <DiverList
      page={emptyPage}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
      cursorActive={false}
      locale="en-US"
      importHref={importHref}
      copy={copy}
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
    renderList({ filter: "insured" });
    expect(screen.getByText("No divers match this view.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all divers" })).toBeInTheDocument();
  });
});
