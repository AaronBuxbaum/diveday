// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusMark, type StatusMarkVariant } from "./StatusMark";

afterEach(cleanup);

const variants: StatusMarkVariant[] = [
  "success",
  "warning",
  "danger",
  "checked",
  "unchecked",
];

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
    const { container } = render(
      <StatusMark variant="danger" size="lg" className="text-danger" />,
    );
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("size-6", "shrink-0", "text-danger");
  });
});
