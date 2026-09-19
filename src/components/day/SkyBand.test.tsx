// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SKY_SCHEMES } from "@/lib/sky-scheme";
import { SkyBand } from "./SkyBand";

afterEach(cleanup);

describe("SkyBand", () => {
  it("wears the scheme it was given", () => {
    const { container } = render(
      <SkyBand scheme="dusk">
        <p>Night Dive</p>
      </SkyBand>,
    );
    const band = container.firstElementChild;
    expect(band?.getAttribute("data-scheme")).toBe("dusk");
    expect(band?.className).toContain("sky");
    expect(screen.getByText("Night Dive")).toBeTruthy();
  });

  /**
   * Four schemes, four gradients, and no fifth path: a scheme with no rule in
   * `globals.css` would fall through to the day sky at midnight, which reads as
   * a bug in the almanac rather than in the stylesheet.
   */
  it("has a rule in the stylesheet for every scheme the almanac can return", async () => {
    const css = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/globals.css", "utf8"),
    );
    for (const scheme of SKY_SCHEMES) {
      const rule =
        scheme === "day"
          ? /\.sky\s*\{[^}]*background:\s*var\(--sky-day\)/
          : new RegExp(
              `\\.sky\\[data-scheme="${scheme}"\\]\\s*\\{[^}]*background:\\s*var\\(--sky-${scheme}\\)`,
            );
      expect(css, `--sky-${scheme} is drawn`).toMatch(rule);
      expect(css, `--sky-${scheme} is defined`).toContain(`--sky-${scheme}: linear-gradient(`);
    }
  });

  /**
   * A gradient is a range of contrasts by definition. A reader who asked for
   * more contrast asked for the range to stop, and the crew in sun asked the
   * same thing in different words.
   */
  it("flattens under more contrast and in glare mode", async () => {
    const css = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/globals.css", "utf8"),
    );
    expect(css).toMatch(/@media \(prefers-contrast: more\) \{\s*\.sky,/);
    expect(css).toContain(".glare-mode .sky,");
  });
});
