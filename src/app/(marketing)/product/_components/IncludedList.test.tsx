// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { INCLUDED_PREVIEW_COUNT, IncludedList } from "./IncludedList";

afterEach(cleanup);

const items = Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`);

describe("a feature page's included list", () => {
  it("keeps every line in the document and hides the lines past the preview on a phone", () => {
    render(<IncludedList items={items} showAllLabel="Show all 8" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    const hidden = rows.filter((row) => row.className.includes("max-sm:hidden"));
    expect(hidden).toHaveLength(8 - INCLUDED_PREVIEW_COUNT);
  });

  it("shows every line and drops the button once it is pressed", () => {
    render(<IncludedList items={items} showAllLabel="Show all 8" />);
    const button = screen.getByRole("button", { name: "Show all 8" });
    // The button is a phone's alone: two columns show the whole list.
    expect(button.className).toContain("sm:hidden");
    fireEvent.click(button);
    expect(screen.queryByRole("button")).toBeNull();
    for (const row of screen.getAllByRole("listitem")) {
      expect(row.className).not.toContain("max-sm:hidden");
    }
  });

  it("draws no button for a list that already fits", () => {
    render(<IncludedList items={items.slice(0, INCLUDED_PREVIEW_COUNT)} showAllLabel="Show all" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
