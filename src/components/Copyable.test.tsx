// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
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

const LINK = "https://diveday.app/s/reef-shop/trips/bookable-light";

function renderPanel() {
  return render(
    <Copyable
      value={LINK}
      label="Your booking link"
      copyLabel="Copy link"
      copiedLabel="Copied"
      failedLabel="Select it and copy"
    />,
  );
}

/**
 * **The panel's words set its insets, not its button** (docs/design/
 * pixel-craft.md, class 5). The header row lined the label up with a 44px
 * `ghost sm` trigger by baseline, so the trigger's height deepened the band
 * above the label to 27px against 13px under the URL, and its invisible
 * `px-3` left "Copy link" 23px inside the panel's right edge where the label
 * started 11px inside the left (today-first-bookable, 1280 and 390).
 */
describe("Copyable's panel", () => {
  it("centres its header row rather than lining it up by baseline", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Copy link" }).parentElement;
    expect(row).toHaveClass("items-center");
    expect(row).not.toHaveClass("items-baseline");
  });

  it("gives its trigger's extra height and padding back, so the label's line is the row", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "Copy link" });
    // (44px target − 20px label line) / 2: the target stays 44px tall, and the
    // row is exactly the label's line box.
    expect(trigger).toHaveClass("-my-3");
    // `flush` on a ghost: 8px of room for the fill, handed back as a margin,
    // so the label ends on the panel's inset as the caption starts on it.
    expect(trigger).toHaveClass("-mx-2", "px-2");
    expect(trigger).not.toHaveClass("px-3");
  });
});

describe("Copyable inline", () => {
  it("keeps the plain ghost trigger, which sits in a row of its caller's", () => {
    render(
      <Copyable
        layout="inline"
        value="SPRING24"
        copyLabel="Copy"
        copiedLabel="Copied"
        failedLabel="Select it and copy"
      />,
    );
    expect(screen.getByRole("button", { name: "Copy" }).className).toBe(
      buttonClass({ variant: "ghost", size: "sm" }),
    );
  });
});
