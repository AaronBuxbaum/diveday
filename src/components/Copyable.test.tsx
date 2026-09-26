// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { Copyable } from "./Copyable";

afterEach(cleanup);

const labels = { copyLabel: "Copy", copiedLabel: "Copied", failedLabel: "Copy failed" };

/**
 * A quiet trigger's word sits 12px inside its box, painted only on hover, so
 * where the trigger starts or ends a line its word misses the column the text
 * around it keeps: the embed page's "Copy" at x 446 against the field's 433,
 * the party panel's "Copy reminder link" 12px inside the seat's name (pixel
 * probe, K-06). Where the button sits is the caller's to know, so the caller
 * says so; the panel, whose header row the button always ends, says it itself.
 */
describe("Copyable's trigger", () => {
  it("keeps its padding inline by default, a word among others on its row", () => {
    render(<Copyable layout="inline" value="SPRING10" {...labels} />);
    expect(rendersFlush(screen.getByRole("button", { name: "Copy" }), "ghost", "sm")).toBe(false);
  });

  it("puts its word on the column when an inline caller starts a line with it", () => {
    render(<Copyable layout="inline" flush value="https://example.test/claim" {...labels} />);
    expect(rendersFlush(screen.getByRole("button", { name: "Copy" }), "ghost", "sm")).toBe(true);
  });

  it("ends the panel's header row on the panel's inset, ringed inside the panel", () => {
    // The panel's 12px inset leaves a flush fill 4px from its edge, short of
    // the outset ring's 5px, which would stand a pixel outside the sunken box.
    render(<Copyable value="webcal://example.test/feed" label="Calendar feed" {...labels} />);
    const trigger = screen.getByRole("button", { name: "Copy" });
    expect(rendersFlush(trigger, "ghost", "sm")).toBe(true);
    expect(trigger).toHaveClass("focus-visible:focus-ring-inset");
  });
});
