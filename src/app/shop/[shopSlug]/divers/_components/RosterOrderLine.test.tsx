// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RosterOrderLine, rosterHref } from "./RosterOrderLine";

afterEach(cleanup);
const t = staffTranslator("en-US");
const roster = "/shop/blue-mantis/divers";

/** "Sort: Name · Last dived" and the list's CSV (fourth UX review, item 27). */
describe("the roster's order line", () => {
  it("links the other order, keeping the search and the view", () => {
    render(
      <RosterOrderLine
        roster={roster}
        query="reyes"
        filter="not_back"
        sort="name"
        canDownload
        t={t}
      />,
    );
    expect(screen.getByRole("link", { name: "Last dived" })).toHaveAttribute(
      "href",
      `${roster}?q=reyes&filter=not_back&sort=last_dived`,
    );
    expect(screen.getByText("Name")).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("link", { name: "Download this list (CSV)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Download this list (CSV)" })).toHaveAttribute(
      "href",
      `${roster}/download?q=reyes&filter=not_back`,
    );
  });

  it("offers no download to a staffer without the people-export permission", () => {
    render(
      <RosterOrderLine
        roster={roster}
        query=""
        filter="all"
        sort="last_dived"
        canDownload={false}
        t={t}
      />,
    );
    expect(screen.queryByRole("link", { name: "Download this list (CSV)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("pages without dropping the order", () => {
    expect(rosterHref(roster, { query: "", filter: "all", sort: "last_dived", page: 2 })).toBe(
      `${roster}?sort=last_dived&page=2`,
    );
    expect(rosterHref(roster, { query: "", filter: "all", sort: "name", page: 1 })).toBe(roster);
  });
});
