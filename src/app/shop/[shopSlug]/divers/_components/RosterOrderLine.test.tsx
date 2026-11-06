// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RosterOrderLine, rosterHref } from "./RosterOrderLine";

afterEach(cleanup);
const t = staffTranslator("en-US");
const roster = "/shop/blue-mantis/divers";

/** "Sort: Name · Last dived" (fourth UX review, item 27). */
describe("the roster's order line", () => {
  it("links the other order, keeping the search and the view", () => {
    render(<RosterOrderLine roster={roster} query="reyes" filter="not_back" sort="name" t={t} />);
    expect(screen.getByRole("link", { name: "Last dived" })).toHaveAttribute(
      "href",
      `${roster}?q=reyes&filter=not_back&sort=last_dived`,
    );
    expect(screen.getByText("Name")).toHaveAttribute("aria-current", "true");
  });

  it("pages without dropping the order", () => {
    expect(rosterHref(roster, { query: "", filter: "all", sort: "last_dived", page: 2 })).toBe(
      `${roster}?sort=last_dived&page=2`,
    );
    expect(rosterHref(roster, { query: "", filter: "all", sort: "name", page: 1 })).toBe(roster);
  });
});
