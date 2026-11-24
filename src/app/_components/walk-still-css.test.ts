import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("a still walk", () => {
  it("pauses its animations over the beat's own shorthand, so the first card's page swap waits for a reader", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/\[data-walk-idle\] \*::after \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/animation-play-state:\s*paused\s*!important/);
  });
});
