// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusMark, type StatusMarkVariant } from "./StatusMark";

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
});
