// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityToolbar } from "./ActivityToolbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shop/blue-mantis/settings/activity",
}));

afterEach(cleanup);

const COPY = {
  personLabel: "Person",
  personAll: "Everyone",
  kindLabel: "What happened",
  kindAll: "Everything",
  fromLabel: "From",
  toLabel: "To",
  clear: "Clear",
  count: "84 entries",
};

function renderToolbar() {
  return render(
    <ActivityToolbar
      personId=""
      kind=""
      from="2026-10-01"
      to="2026-10-12"
      people={[]}
      kinds={[]}
      copy={COPY}
    />,
  );
}

/**
 * **Two date boxes look alike, so each says which end it is** (#2314). The
 * selects state their own value ("Everyone", "Everything") and keep their
 * labels for a screen reader only; a date box shows a date, which says
 * nothing about whether it starts or ends the range.
 */
describe("the activity toolbar's date range", () => {
  it("captions From and To where a sighted staffer can read them", () => {
    renderToolbar();
    for (const [name, id] of [
      ["From", "activity-from"],
      ["To", "activity-to"],
    ] as const) {
      const input = screen.getByLabelText(name);
      expect(input).toHaveAttribute("id", id);
      const caption = screen.getByText(name, { selector: "label" });
      expect(caption).not.toHaveClass("sr-only");
    }
  });

  it("keeps the selects' labels for a screen reader only", () => {
    renderToolbar();
    expect(screen.getByText("Person", { selector: "label" })).toHaveClass("sr-only");
    expect(screen.getByText("What happened", { selector: "label" })).toHaveClass("sr-only");
  });
});
