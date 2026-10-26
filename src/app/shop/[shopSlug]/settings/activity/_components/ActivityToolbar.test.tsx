// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityToolbar } from "./ActivityToolbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shop/blue-mantis/settings/activity",
}));

afterEach(cleanup);

function renderToolbar() {
  render(
    <ActivityToolbar
      personId=""
      kind=""
      from=""
      to=""
      people={[]}
      kinds={[]}
      copy={{
        personLabel: "Who",
        personAll: "Everyone",
        kindLabel: "What",
        kindAll: "Everything",
        fromLabel: "From",
        toLabel: "To",
        clear: "Clear",
        count: "84 entries",
        filter: "Filter",
        activeRange: "",
      }}
    />,
  );
}

describe("the activity log's toolbar", () => {
  // Issue #2314: two identical date boxes, told apart only by a screen reader.
  it("names each date box with a caption a sighted staffer can read", () => {
    renderToolbar();
    for (const name of ["From", "To"]) {
      const box = screen.getByLabelText(name);
      expect(box).toHaveAttribute("type", "date");
      const caption = screen.getByText(name, { selector: "label" });
      expect(caption).not.toHaveClass("sr-only");
    }
  });

  it("keeps the selects' captions for the screen reader: each select states its own value", () => {
    renderToolbar();
    expect(screen.getByText("Who", { selector: "label" })).toHaveClass("sr-only");
    expect(screen.getByText("What", { selector: "label" })).toHaveClass("sr-only");
  });
});
