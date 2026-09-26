// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.tsx` under `src/`, so the sweep below can be stated as a fact. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * The `action={…}` expression of every `<EmptyState …>` opening tag in a file,
 * found by walking brace depth rather than by a regex, because the action is
 * usually a ternary over two whole elements.
 */
function emptyStateActions(source: string): string[] {
  const actions: string[] = [];
  for (const opening of source.matchAll(/<EmptyState(?=[\s>/])/g)) {
    let depth = 0;
    let attribute = "";
    let action: string | null = null;
    for (let cursor = opening.index ?? 0; cursor < source.length; cursor++) {
      const char = source[cursor];
      if (depth === 0 && char === '"') {
        // A string attribute: skip it whole, so a `>` inside one is not the tag's end.
        const close = source.indexOf('"', cursor + 1);
        attribute += source.slice(cursor, close + 1);
        cursor = close;
      } else if (char === "{") {
        if (depth === 0 && attribute.endsWith("action=")) action = "";
        else if (action !== null) action += char;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && action !== null) {
          actions.push(action);
          action = null;
        } else if (action !== null) action += char;
      } else if (action !== null) action += char;
      else if (depth === 0 && char === ">" && source[cursor - 1] !== "=") break;
      else if (depth === 0) attribute += char;
    }
  }
  return actions;
}

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

  /**
   * A card inside a card casts no shadow of its own (docs/design/pixel-craft.md,
   * class 6). The Crew card's "nobody assigned yet" box painted `bg-surface
   * shadow-bed` on the card's own white, so a 30px shadow faded out under its
   * dashed border onto the panel it sits in.
   */
  it("draws a nested card as the dashed outline alone, with no fill or bed shadow", () => {
    const { container } = render(<EmptyState title="Nobody assigned yet" icon={false} nested />);
    const card = container.firstElementChild;
    expect(card).toHaveClass("border-dashed", "bg-transparent");
    expect(card).not.toHaveClass("shadow-bed");
    expect(card).not.toHaveClass("bg-surface");
  });

  it("stands a page-level card on the bed, as every panel does", () => {
    const { container } = render(<EmptyState title="No trips yet" />);
    expect(container.firstElementChild).toHaveClass("bg-surface", "shadow-bed", "border-dashed");
  });

  /**
   * The bubbles fill their box (see the glyph's own test), so the box is
   * sized to the ink: 28px holds the same 24px of bubbles the old 40px box
   * drew, with 2px above them instead of 8px. That is what keeps the panel's
   * top air (border to bubbles) level with its bottom air (button to border)
   * rather than 7px heavier (pixel-craft K-70).
   */
  it("draws the bubbles in a box sized to their ink", () => {
    const { container } = render(<EmptyState title="Nothing yet" />);
    const glyph = container.querySelector("svg");
    expect(glyph).toHaveClass("size-7");
    expect(glyph).not.toHaveClass("size-10");
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

  it("wraps its body so no word is left alone on the last line", () => {
    // The schedule builder's empty board left "booking." alone on a second
    // line of its centred body at 1280 (docs/design/pixel-craft.md, class 8).
    render(<EmptyState title="No trips yet" body="Put a departure on the board." />);
    expect(screen.getByText("Put a departure on the board.")).toHaveClass("text-pretty");
  });

  /**
   * **The gap above the action is the card's, and nobody else's**
   * (docs/design/pixel-craft.md, class 4). The action row already sits `mt-4`
   * under the body; a link that brought an `mt-4` of its own doubled it, so the
   * schedule builder's empty board put 35px between its sentence and its button
   * where the card's rhythm is 16px, and a trip's course-requirements card 34px.
   */
  it("owns the gap above its action, which no call site adds to", () => {
    const offenders = tsxFiles(SRC_DIR)
      .filter((file) => !file.endsWith(".test.tsx"))
      .flatMap((file) =>
        emptyStateActions(readFileSync(file, "utf8"))
          .filter((action) => /(^|[\s"'`])mt-/.test(action))
          .map(() => relative(SRC_DIR, file)),
      );
    // Listed, not counted — the file is what a reader needs.
    expect(offenders).toEqual([]);
  });

  it("finds the actions it sweeps", () => {
    // The sweep above is only as good as its parser: pin it on a ternary
    // action beside a string attribute holding a `>`.
    const source = `<EmptyState title="a > b" action={x ? <A className="mt-4" /> : <B />} />`;
    expect(emptyStateActions(source)).toEqual(['x ? <A className="mt-4" /> : <B />']);
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
