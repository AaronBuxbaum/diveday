// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompactDisclosureRow, DisclosureRow, DisclosureRowList } from "./disclosure";

describe("DisclosureRow's focus ring", () => {
  /**
   * The row sits flush inside `DisclosureRowList`'s `overflow-hidden` card, so
   * the global ring — 5px outside the summary — was cut on both sides of every
   * row and the top of the first (the pixel probe, public schedule captures).
   */
  it("draws it inside the summary, and rounds it into the card's corners at the ends", () => {
    const { container } = render(
      <DisclosureRowList>
        <DisclosureRow id="a" heading="First">
          body
        </DisclosureRow>
        <DisclosureRow id="b" heading="Last">
          body
        </DisclosureRow>
      </DisclosureRowList>,
    );
    for (const summary of container.querySelectorAll("summary")) {
      expect(summary).toHaveClass(
        "focus-visible:focus-ring-inset",
        "[details:first-child>&]:rounded-t-panel",
        "[details:last-child:not([open])>&]:rounded-b-panel",
      );
    }
  });
});

describe("CompactDisclosureRow", () => {
  it("keeps the value visible and the form behind a native disclosure", () => {
    const { container, getByText } = render(
      <CompactDisclosureRow label="Languages" value="English">
        <input aria-label="language" />
      </CompactDisclosureRow>,
    );
    expect(container.querySelector("details")).toBeTruthy();
    expect(getByText("English")).toHaveClass("whitespace-normal", "break-words", "sm:truncate");
    expect(container.querySelector('input[aria-label="language"]')).toBeTruthy();
  });

  it("gives the compact row's hover state breathing room", () => {
    const { container } = render(
      <CompactDisclosureRow label="Languages" value="English">
        <input aria-label="language" />
      </CompactDisclosureRow>,
    );
    expect(container.querySelector("summary")).toHaveClass(
      "-mx-2",
      "px-2",
      "hover:bg-surface-sunken",
    );
  });
});
