// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DisclosureRow, DisclosureRowList, DisclosureRowMessage } from "./disclosure";

afterEach(cleanup);

/**
 * The parts of the row vocabulary a screenshot cannot prove: rows are siblings
 * inside one shell rather than three cards, each row's fragment id lands on the
 * `<details>` itself (so a deep link scopes to the whole row, and
 * `AutoOpenDetails` is what opens it), and every heading is an `h3` — the level
 * a group's members take under the group's own `h2`.
 */
describe("DisclosureRow", () => {
  it("is a details carrying its own fragment id, with the heading inside the summary", () => {
    const { container } = render(
      <DisclosureRow id="last-minute-list" heading="Want a deal on a last-minute spot?">
        <p>Body</p>
      </DisclosureRow>,
    );
    const details = container.querySelector("details#last-minute-list");
    expect(details).not.toBeNull();
    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Want a deal on a last-minute spot?",
    });
    expect(heading.closest("summary")).not.toBeNull();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("spells no card and no margin of its own — the list owns both", () => {
    const { container } = render(
      <DisclosureRow id="find-my-booking" heading="Can't find your link?">
        <p>Body</p>
      </DisclosureRow>,
    );
    const details = container.querySelector("details");
    // `scroll-mt-8` is the anchor offset, not section rhythm — hence the
    // lookbehind rather than a word boundary.
    expect(details?.className ?? "").not.toMatch(/(?<![\w-])(rounded-|border|shadow-|mt-\d)/);
  });
});

describe("DisclosureRowMessage", () => {
  it("keeps the row's id and heading level, and offers nothing left to open", () => {
    const { container } = render(
      <DisclosureRowMessage id="last-minute-list" heading="You're on the list.">
        We'll email you if a discounted spot opens up.
      </DisclosureRowMessage>,
    );
    expect(container.querySelector("#last-minute-list")).not.toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "You're on the list." })).toBeVisible();
  });
});

describe("DisclosureRowList", () => {
  it("is one shell of divided rows, not a card per row", () => {
    const { container } = render(
      <DisclosureRowList className="mt-4">
        <DisclosureRow id="a" heading="A">
          <p>a</p>
        </DisclosureRow>
        <DisclosureRow id="b" heading="B">
          <p>b</p>
        </DisclosureRow>
      </DisclosureRowList>,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass("rounded-2xl", "divide-y", "divide-border", "mt-4");
    expect(container.querySelectorAll("details")).toHaveLength(2);
    // Every row is a direct child of the one shell — a row that wrapped itself
    // in a card again would show up here as a nested surface.
    for (const details of container.querySelectorAll("details")) {
      expect(details.parentElement).toBe(shell);
    }
  });
});
