// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPEATING_ITEM_CARD_CLASS,
  RepeatingItemCard,
  repeatingItemAddClass,
  repeatingItemRemoveClass,
} from "./RepeatingItemCard";

afterEach(cleanup);

/**
 * **One card for an editor's repeating items** (docs/design/pixel-craft.md,
 * class 12). The course editor's days and questions and the dive-site editor's
 * landmarks and field-guide species were four cards: unfilled or grey, 16px or
 * 12px of padding, a bordered red, a borderless red or a grey Remove, at the
 * head of the card, at its foot or inside a row of fields, and a 48px or a
 * 44px Add under the list.
 */
describe("RepeatingItemCard", () => {
  function renderDay() {
    return render(
      <RepeatingItemCard
        title={<h4>Day 2</h4>}
        remove={
          <button type="button" className={repeatingItemRemoveClass}>
            Remove day
          </button>
        }
      >
        <input aria-label="Day 2 title" />
      </RepeatingItemCard>,
    );
  }

  it("is one sunken inset with 16px of padding", () => {
    const { container } = renderDay();
    const card = container.firstElementChild;
    expect(card).toHaveClass(...REPEATING_ITEM_CARD_CLASS.split(" "));
    expect(card).toHaveClass("bg-surface-sunken", "rounded-inset", "border", "p-4");
    expect(card?.className).not.toMatch(/(^|\s)(sm:)?p-3(\s|$)|sm:p-/);
  });

  it("holds the title and the remove act in one header row, the remove at its end", () => {
    renderDay();
    const title = screen.getByRole("heading", { name: "Day 2" });
    const remove = screen.getByRole("button", { name: "Remove day" });
    const header = remove.parentElement;
    expect(header).toContainElement(title);
    expect(header?.lastElementChild).toBe(remove);
    expect(header).toHaveClass("flex", "items-center", "justify-between");
    // The fields come after the header, never beside it.
    expect(header).not.toContainElement(screen.getByRole("textbox", { name: "Day 2 title" }));
  });

  it("keeps the remove act at the header's end when an item has no title", () => {
    render(
      <RepeatingItemCard
        remove={
          <button type="button" className={repeatingItemRemoveClass}>
            Remove question 1
          </button>
        }
      >
        <input aria-label="Question 1" />
      </RepeatingItemCard>,
    );
    const remove = screen.getByRole("button", { name: "Remove question 1" });
    expect(remove.parentElement?.firstElementChild).not.toBe(remove);
    expect(remove.parentElement?.lastElementChild).toBe(remove);
  });

  it("renders as a list item for an editor whose items are a list", () => {
    const { container } = render(
      <ul>
        <RepeatingItemCard as="li" remove={<button type="button">Remove</button>}>
          <p>Stoplight parrotfish</p>
        </RepeatingItemCard>
      </ul>,
    );
    expect(container.querySelector("ul > li")).toHaveClass(...REPEATING_ITEM_CARD_CLASS.split(" "));
  });

  it("gives every Remove one quiet danger button, its label on the card's content edge", () => {
    expect(repeatingItemRemoveClass).toContain("text-danger");
    expect(repeatingItemRemoveClass).toContain("min-h-11");
    expect(repeatingItemRemoveClass).toContain("-mx-2");
    expect(repeatingItemRemoveClass).not.toMatch(/(^|\s)border(\s|$)/);
  });

  it("gives every Add under a list one size", () => {
    expect(repeatingItemAddClass).toContain("min-h-11");
    expect(repeatingItemAddClass).toContain("text-sm");
  });
});
