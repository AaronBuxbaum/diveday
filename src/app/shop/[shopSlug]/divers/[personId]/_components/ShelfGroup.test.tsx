// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ShelfGroup } from "./ShelfGroup";

// The action drags the database and the Next server runtime in behind it.
vi.mock("../actions", () => ({ sendShelfLinkAction: vi.fn() }));

afterEach(cleanup);

/**
 * **The shelf's rows sit where every other group's rows sit.** The group is an
 * `InsetGroup`, whose card is `overflow-hidden` and pads nothing, so each row
 * brings its own inset. The shelf's two rows had the summary's `px-1`: text
 * 4px from the card's edge, the Send button's border on the divider above it,
 * and the button's 5px focus ring cut by a pixel (pixel probe,
 * `diver-record-shelf`). The notes and conversation groups pad their rows
 * `px-5 py-4 sm:px-6`. jsdom has no layout, so this pins which element
 * carries the inset; the probe measures the ring.
 */
describe("ShelfGroup", () => {
  it("insets both rows as the record's other groups do (px-5 py-4 sm:px-6), the facts row and the form that holds Send the link", () => {
    render(
      <ShelfGroup
        shopSlug="blue-mantis"
        personId="p-1"
        standing={{ opens: 1, live: 1, phones: 1, lastOpenedAt: new Date("2026-07-21T15:00:00Z") }}
        locale="en-US"
        timezone="America/New_York"
        t={staffTranslator("en-US")}
      />,
    );

    const form = screen.getByRole("button", { name: "Send the link" }).closest("form");
    const facts = screen.getByText("1 phone holds it").parentElement;
    for (const row of [facts, form]) {
      expect(row).toHaveClass("px-5", "py-4", "sm:px-6");
      expect(row?.className).not.toMatch(/(^|\s)px-1(\s|$)/);
    }
    expect(facts?.nextElementSibling).toBe(form);
  });
});
