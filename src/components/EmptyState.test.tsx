// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

/**
 * **The shape, pinned** — because the thing that went wrong here was not a bug
 * in the component, it was the absence of one. `EmptyState`'s whole API was
 * `children`, so 46 call sites invented 46 anatomies and twenty of them were a
 * single muted sentence with no heading at all: `docs/design/brand.md`'s "No
 * records found" wearing a nicer border (issue #774).
 */
describe("EmptyState", () => {
  it("renders the teaching line as a heading, at h2 by default", () => {
    render(<EmptyState title="No trips yet" />);
    expect(screen.getByRole("heading", { level: 2, name: "No trips yet" })).toBeInTheDocument();
  });

  /**
   * The level is document structure, not style: a card nested inside a section
   * that already has an `h2` needs an `h3`, which the component cannot work out
   * for itself. Same arrangement as `SectionCard`'s `titleAs`.
   */
  it("takes h3 for a card inside a section that already has a heading", () => {
    render(<EmptyState titleAs="h3" title="No divers on this boat" />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("No divers on this boat");
  });

  it("renders nothing for the optional slots when they are absent", () => {
    const { container } = render(<EmptyState title="Nothing yet" icon={false} />);
    // Title only: no stray paragraph, no empty action row to space around.
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("carries a body and an action when there is something to say and somewhere to go", () => {
    render(
      <EmptyState
        title="No trips yet"
        body="Schedule your first charter."
        action={<a href="/board">Open the board</a>}
      />,
    );
    expect(screen.getByText("Schedule your first charter.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the board" })).toBeInTheDocument();
  });

  /**
   * One card is its section's accessible name, which is the only reason the id
   * is exposed at all — the day spine's `aria-labelledby="queue-heading"`.
   */
  it("lends its heading an id for a section that names itself by it", () => {
    render(<EmptyState titleId="queue-heading" title="Nothing waiting" />);
    expect(screen.getByRole("heading", { name: "Nothing waiting" })).toHaveAttribute(
      "id",
      "queue-heading",
    );
  });
});
