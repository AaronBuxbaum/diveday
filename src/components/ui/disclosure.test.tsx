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
    expect(getByText("English")).toBeTruthy();
    expect(container.querySelector('input[aria-label="language"]')).toBeTruthy();
  });
});
