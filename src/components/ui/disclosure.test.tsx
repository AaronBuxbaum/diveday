// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompactDisclosureRow } from "./disclosure";

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
