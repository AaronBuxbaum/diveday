// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusMark, StatusMarkColumn, type StatusMarkVariant } from "./StatusMark";

afterEach(cleanup);

const variants: StatusMarkVariant[] = ["success", "warning", "danger", "checked", "unchecked"];

describe("StatusMark", () => {
  it.each(variants)("renders %s as a decorative SVG", (variant) => {
    const { container } = render(<StatusMark variant={variant} />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveClass("size-4", "shrink-0");
    expect(container.textContent).toBe("");
  });

  it("keeps the requested size and caller class", () => {
    const { container } = render(<StatusMark variant="danger" size="lg" className="text-danger" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("size-6", "shrink-0", "text-danger");
  });

  /**
   * **A bare `<svg>` cannot sit in a line of text.** Tailwind's preflight makes
   * every `svg` `display: block`, so a mark written in front of its words —
   * `ShopNotice`'s `<StatusMark className="me-1" />{children}`, the printed
   * pre-departure list's `<StatusMark />{" "}{line}` — took a line of its own
   * above them, and `me-1` spaced it from nothing (K-15). The inline spelling
   * is a box one line tall, standing at the top of the line it opens, with the
   * mark centred in it: where the line's own capitals are centred.
   */
  it("stands inline as a one-line box with the mark centred in it", () => {
    const { container } = render(<StatusMark variant="warning" inline className="text-warning" />);
    const box = container.firstElementChild;
    const svg = container.querySelector("svg");

    expect(box?.tagName).toBe("SPAN");
    expect(box).toHaveClass("inline-flex", "h-lh", "items-center", "align-top");
    expect(svg?.parentElement).toBe(box);
    // The caller's class still reaches the mark itself, which is what it colours.
    expect(svg).toHaveClass("size-4", "shrink-0", "text-warning");
  });

  it("renders the bare svg when it is not asked to stand inline", () => {
    const { container } = render(<StatusMark variant="success" />);

    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("svg");
  });

  /**
   * **A bare mark heading a flex row has no line to sit on.** In a stretched
   * row it stood at the top of the words' 20px line, 2.5px above its centre
   * (K-494, the roster's blocker and warning lines). A row that was itself
   * the baseline for its parent lent that parent the mark's foot, which flex
   * synthesizes as a missing baseline: the roster's group band sat "STILL TO
   * CLEAR" 5px under the fact beside it (K-181). The column is a block (the
   * row's flex item) holding the inline one-line box, so it has a real line
   * and a real first baseline, with the mark centred on that line.
   */
  it("heads a row as a block holding one line of the row's text, the mark centred in it", () => {
    const { container } = render(<StatusMarkColumn variant="danger" className="text-danger" />);
    const column = container.firstElementChild;
    const line = column?.firstElementChild;

    expect(column?.tagName).toBe("SPAN");
    expect(column).toHaveClass("shrink-0");
    expect(line).toHaveClass("inline-flex", "h-lh", "items-center", "align-top");
    expect(line?.querySelector("svg")).toHaveClass("size-4", "shrink-0", "text-danger");
  });

  it("is the only spelling of that column: no hand-rolled wrapper around an inline mark", () => {
    // `ShopNotice` wrapped `<StatusMark inline />` in its own `shrink-0` span
    // before the column had a name; a second copy is how the roster's rows
    // ended up with bare marks instead.
    const root = join(process.cwd(), "src");
    const handCopy = /<span className="shrink-0">\s*<StatusMark\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          path.endsWith(".tsx") &&
          !path.endsWith(".test.tsx") &&
          !path.endsWith(join("ui", "StatusMark.tsx")) &&
          handCopy.test(readFileSync(path, "utf8"))
        ) {
          offenders.push(relative(process.cwd(), path));
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
