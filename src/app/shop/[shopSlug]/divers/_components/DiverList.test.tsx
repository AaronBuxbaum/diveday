// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const emptyPage: DiverPage = { divers: [], total: 0, page: 1, pageCount: 0, pageSize: 25 };

/**
 * One diver, carrying only what the list actually renders. The real row is a
 * whole `people` record the summary query already strips (date of birth,
 * insurance, emergency contact) before it crosses to the client, so spelling
 * the rest of it out here would assert nothing.
 */
const populatedPage: DiverPage = {
  ...emptyPage,
  total: 1,
  pageCount: 1,
  divers: [
    {
      person: { id: "diver-1", fullName: "Rosa Marín", email: "rosa@example.com", phone: null },
      certificationCount: 1,
      pendingCertificationCount: 0,
      specialtyCount: 0,
      pendingSpecialtyOrNitroxCount: 0,
      importedUnconfirmedCount: 0,
      nitroxCertificationCount: 0,
      rentalFit: null,
    },
  ] as unknown as DiverPage["divers"],
};

const copy = {
  viewAllDivers: t("divers.list.viewAllDivers"),
  viewMissingContact: t("divers.list.viewMissingContact"),
  viewInsured: t("divers.list.viewInsured"),
  savedViewsAriaLabel: t("divers.list.savedViewsAriaLabel"),
  namePromptText: t("divers.list.namePromptText"),
  removeSavedViewAriaLabel: t("divers.list.removeSavedViewAriaLabel"),
  saveThisView: t("divers.list.saveThisView"),
  saveViewConfirm: t("divers.list.saveViewConfirm"),
  saveViewCancel: t("divers.list.saveViewCancel"),
  savedOnThisDevice: t("divers.list.savedOnThisDevice"),
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
};

function renderList({
  query = "",
  filter = "all" as DiverFilter,
  importHref = "/shop/blue-mantis/settings/import" as string | null,
  page = emptyPage,
} = {}) {
  return render(
    <DiverList
      page={page}
      shopSlug="blue-mantis"
      query={query}
      filter={filter}
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

/**
 * Naming a saved view. This used to be `window.prompt`, which blocks the tab,
 * renders in whatever language the browser chrome is set to rather than the
 * shop's, and on the shared counter tablet arrives as a system sheet over the
 * roster. The replacement is a form in the page — so the assertions below are
 * about a real input and a real submit, and the first one is the regression
 * guard that no native dialog is reached for at all.
 */
describe("DiverList saved views", () => {
  const VIEWS_KEY = "diveday:diver-views:blue-mantis";

  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("names a view in the page, never through a native prompt", async () => {
    const prompt = vi.spyOn(window, "prompt");
    renderList({ page: populatedPage });

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Name this view" })).toHaveFocus();
    prompt.mockRestore();
  });

  it("pins the named view as a chip carrying the search and filter it was saved from", async () => {
    renderList({ query: "nitrox", filter: "missing_contact" });

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name this view" }), "Sunday boat");
    await userEvent.click(screen.getByRole("button", { name: "Save view" }));

    expect(JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? "[]")).toEqual([
      { name: "Sunday boat", query: "nitrox", filter: "missing_contact" },
    ]);
    // Both halves of the view survive the round trip into the chip's href —
    // dropping the filter is exactly the bug that would leave a staffer
    // looking at the whole roster under their own view's name.
    expect(screen.getByRole("link", { name: "Sunday boat" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers?q=nitrox&filter=missing_contact",
    );
    // The form closes behind the save rather than sitting open with the name
    // still in it, ready to pin a duplicate on a stray second tap.
    expect(screen.queryByRole("textbox", { name: "Name this view" })).toBeNull();
  });

  it("re-saving a name replaces that view instead of pinning a second chip", async () => {
    window.localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify([{ name: "Sunday boat", query: "old", filter: "all" }]),
    );
    renderList({ query: "nitrox", filter: "insured" });

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name this view" }), "Sunday boat");
    await userEvent.click(screen.getByRole("button", { name: "Save view" }));

    expect(JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? "[]")).toEqual([
      { name: "Sunday boat", query: "nitrox", filter: "insured" },
    ]);
    expect(screen.getAllByRole("link", { name: "Sunday boat" })).toHaveLength(1);
  });

  it("refuses to pin a view with no name on it", async () => {
    renderList({ page: populatedPage });

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();
    // Whitespace is not a name either — a chip labelled with a space is
    // unclickable-looking and unremovable-looking.
    await userEvent.type(screen.getByRole("textbox", { name: "Name this view" }), "   ");
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();
    expect(window.localStorage.getItem(VIEWS_KEY)).toBeNull();
  });

  it("backs out on Escape and on Never mind, saving nothing either way", async () => {
    renderList({ page: populatedPage });

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name this view" }), "Half typed");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name this view" })).toBeNull();
    expect(window.localStorage.getItem(VIEWS_KEY)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    // Reopening starts clean rather than resurrecting the abandoned name.
    expect(screen.getByRole("textbox", { name: "Name this view" })).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Never mind" }));
    expect(screen.queryByRole("textbox", { name: "Name this view" })).toBeNull();
    expect(window.localStorage.getItem(VIEWS_KEY)).toBeNull();
  });

  it("says where the views actually live, and only once there are some", async () => {
    renderList({ page: populatedPage });
    // Nothing pinned yet: a note about storage with nothing stored is noise.
    expect(screen.queryByText("Saved on this device")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "+ Save this view" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name this view" }), "Sunday boat");
    await userEvent.click(screen.getByRole("button", { name: "Save view" }));

    // The counter tablet's views are that tablet's. Saying so is the honest
    // version of a per-browser store there is no per-account home for yet.
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
  });

  it("unpins a saved view from the chip's own remove control", async () => {
    window.localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify([{ name: "Sunday boat", query: "", filter: "all" }]),
    );
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Remove saved view Sunday boat" }));
    expect(JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? "[]")).toEqual([]);
    expect(screen.queryByRole("link", { name: "Sunday boat" })).toBeNull();
  });

  /**
   * The remove control is a 24px glyph, and a 24px glyph is not a target —
   * principle 2's dock test puts the floor at 44px. The box grew; the × did
   * not. The negative margin is vertical only: bleeding sideways would lay
   * "remove this view" over the right edge of the chip that *applies* it.
   */
  it("gives the remove control a dock-test-sized target around a small glyph", () => {
    window.localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify([{ name: "Sunday boat", query: "", filter: "all" }]),
    );
    renderList();

    const remove = screen.getByRole("button", { name: "Remove saved view Sunday boat" });
    expect(remove).toHaveClass("size-11");
    expect(remove.className).not.toMatch(/(^|\s)-m[xlr]-/);
  });
});

/**
 * Day one: no divers, no search, no filter, no pinned views. Three chips that
 * all resolve to the same nothing plus an offer to pin it are controls with
 * nothing to govern, and they push the empty card's "Add your first diver"
 * down the page.
 */
describe("DiverList saved-views row on an empty roster", () => {
  const VIEWS_KEY = "diveday:diver-views:blue-mantis";

  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("is gone when there is nothing to govern", () => {
    renderList();
    expect(screen.queryByRole("navigation", { name: "Saved views" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Save this view" })).toBeNull();
    // The one thing that helps is still there.
    expect(screen.getByRole("button", { name: "Add your first diver" })).toBeInTheDocument();
  });

  it("stays when a search narrowed the roster to nothing — that is how you widen back out", () => {
    renderList({ query: "nobody" });
    expect(screen.getByRole("navigation", { name: "Saved views" })).toBeInTheDocument();
  });

  it("stays when a view chip narrowed the roster to nothing", () => {
    renderList({ filter: "insured" });
    expect(screen.getByRole("navigation", { name: "Saved views" })).toBeInTheDocument();
  });

  it("stays when this device already has views pinned, empty roster or not", () => {
    window.localStorage.setItem(
      VIEWS_KEY,
      JSON.stringify([{ name: "Sunday boat", query: "", filter: "all" }]),
    );
    renderList();
    expect(screen.getByRole("navigation", { name: "Saved views" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sunday boat" })).toBeInTheDocument();
  });

  it("is there as soon as there is a roster to govern", () => {
    renderList({ page: populatedPage });
    expect(screen.getByRole("navigation", { name: "Saved views" })).toBeInTheDocument();
  });
});
