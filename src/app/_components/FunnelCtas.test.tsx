// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The demo door is a Server Action; rendering the pair needs only its
// reference, not the session and database behind it.
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));

const { FunnelCtas } = await import("./FunnelCtas");

afterEach(cleanup);

/**
 * **One width for the pair, wherever a page puts it.**
 *
 * Both doors are `w-full sm:w-auto`, and a percentage width resolves against
 * the box it sits in. The pair's own row had no width, so on a phone it took
 * whatever its caller's alignment left it: the pixel probe measured `/product`'s
 * primary at x 24–365 in the hero, 117–272 in the mid-page card
 * (`items-center`) and 24–182 in the closing band (`items-start`), and every
 * switching guide's closing primary at 169px. Below `sm` the pair takes the
 * column's width itself.
 */
describe("the funnel's two doors", () => {
  it("fills the column on a phone and hugs its doors from sm up", () => {
    const { container } = render(<FunnelCtas locale="en-US" source="product" />);
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "w-full",
      "flex-col",
      "sm:w-auto",
      "sm:flex-row",
    );
    for (const door of [
      screen.getByRole("button", { name: "Try the live demo" }),
      screen.getByRole("link", { name: "Get set up" }),
    ]) {
      expect(door).toHaveClass("w-full", "sm:w-auto");
    }
  });

  it("keeps a caller's placement beside its own width", () => {
    const { container } = render(
      <FunnelCtas locale="en-US" source="product" className="mt-8 justify-center" />,
    );
    expect(container.firstElementChild).toHaveClass(
      "w-full",
      "sm:w-auto",
      "mt-8",
      "justify-center",
    );
  });

  /**
   * A switching guide's closing band wraps the pair in an action column of
   * its own, and the band is `items-start` below `sm`: the column shrank to
   * its widest door, so the pair's `w-full` resolved against the shrunk box.
   * The column takes the band's width on a phone, as the pair does.
   */
  it("sits in a guide's closing column as wide as the band on a phone", () => {
    const guide = readFileSync(
      path.join(import.meta.dirname, "..", "switching", "_components", "guide.tsx"),
      "utf8",
    );
    const closing = guide.slice(guide.indexOf("export function ClosingCta"));
    const column = closing.match(/<div className="([^"]*)">\s*<FunnelCtas/)?.[1] ?? "";
    expect(column.split(" ")).toEqual(expect.arrayContaining(["w-full", "sm:w-auto"]));
  });
});
