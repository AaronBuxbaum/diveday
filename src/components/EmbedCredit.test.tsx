// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sourceFiles } from "@/test/source";
import { EmbedCredit } from "./EmbedCredit";

afterEach(cleanup);

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **"Bookings by DiveDay" at the foot of a frame is a 44px target** (pixel-craft
 * class 7, K-217 and K-220). It was a `text-xs` link on a 15px line, 115.7×15,
 * under the storefront's `?embed=1` board and under all three catalogue
 * widgets, each drawn by hand.
 */
describe("EmbedCredit", () => {
  it("makes the credit a 44px target on the 16px line it has always taken", () => {
    const { container } = render(
      <EmbedCredit href="/s/blue-mantis" target="_top">
        Bookings by DiveDay
      </EmbedCredit>,
    );

    const link = screen.getByRole("link", { name: "Bookings by DiveDay" });
    expect(link).toHaveAttribute("href", "/s/blue-mantis");
    expect(link).toHaveAttribute("target", "_top");
    expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
    // The line is the `text-xs` line's 16px, so the frame is laid out as it
    // was; the target centres on it.
    const line = container.firstElementChild;
    expect(line).toHaveClass("flex", "h-4", "items-center", "justify-center", "text-xs");
  });

  /**
   * **The room the target and its ring reach into is the credit's own.** The
   * 44px box reaches 14px each side of the line and the ring 5px past that,
   * so 19px: `mt-4` above (the box; the ring may touch the line above, which
   * clips nothing), and `mb-2` below, which with any frame's 12px padding
   * keeps the ring inside a frame sized to its document. A ring past the
   * document's end is cut off by the host's iframe.
   */
  it("owns the room its target and ring reach into", () => {
    const { container } = render(<EmbedCredit href="/">Bookings by DiveDay</EmbedCredit>);
    expect(container.firstElementChild).toHaveClass("mt-4", "mb-2");
  });

  it("carries rel through for a credit that opens a new tab", () => {
    render(
      <EmbedCredit href="/" target="_blank" rel="noopener">
        Bookings by DiveDay
      </EmbedCredit>,
    );
    expect(screen.getByRole("link", { name: "Bookings by DiveDay" })).toHaveAttribute(
      "rel",
      "noopener",
    );
  });

  /**
   * One credit line, "Bookings by DiveDay" (visual review 2026-10-24, B33):
   * the frames say what the shopfront footer says. The footer draws its own
   * line in the page's chrome; every frame (an `embed` path, or the embed
   * footer) draws it through this component.
   */
  it("is how every frame draws the credit", () => {
    const readers = sourceFiles(SRC_DIR).filter(
      (file) =>
        /[\\/]embed[\\/]|Embed[A-Z]\w*\.tsx$/.test(file) &&
        !file.endsWith(".test.tsx") &&
        readFileSync(file, "utf8").includes('"shopChrome.credit"'),
    );
    expect(readers.length).toBeGreaterThan(0);
    const handDrawn = readers.filter((file) => !/<EmbedCredit\b/.test(readFileSync(file, "utf8")));
    expect(handDrawn.map((file) => relative(SRC_DIR, file))).toEqual([]);
  });
});
