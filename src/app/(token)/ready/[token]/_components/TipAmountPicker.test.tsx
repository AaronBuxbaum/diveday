// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TipAmountPicker } from "./TipAmountPicker";

afterEach(() => {
  cleanup();
});

const copy = {
  legend: "Tip amount",
  otherPlaceholder: "Other",
  otherAriaLabel: "Other tip amount",
};

describe("TipAmountPicker currency (task 60)", () => {
  it("labels presets and the custom field with the shop's own currency symbol, not a hardcoded $", () => {
    render(
      <TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="€" {...copy} />,
    );
    expect(screen.getByText("€10")).toBeInTheDocument();
    expect(screen.getByText("€5")).toBeInTheDocument();
    expect(screen.getByText("€20")).toBeInTheDocument();
    // The custom-amount affix, not just the presets.
    expect(screen.getAllByText("€").length).toBeGreaterThan(0);
  });

  it("still defaults to $ when the shop's currency is usd", () => {
    render(
      <TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="$" {...copy} />,
    );
    expect(screen.getByText("$10")).toBeInTheDocument();
  });

  it("keeps a typed custom amount mutually exclusive with the presets", async () => {
    const user = userEvent.setup();
    render(
      <TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="$" {...copy} />,
    );
    const custom = screen.getByLabelText("Other tip amount");
    await user.type(custom, "42");
    expect(custom).toHaveValue(42);
    const presetInputs = screen.getAllByRole("radio") as HTMLInputElement[];
    for (const input of presetInputs) expect(input.checked).toBe(false);
  });
});

/**
 * **Focus shows on the boxes the eye reads as the controls.** A preset's radio
 * is `sr-only`, so a Tab into the group lit nothing until its label was
 * ringed; the custom field is a 64px strip of the "Other" box, so its own ring
 * would circle the digits alone. The field switching its outline off is one of
 * the two named exceptions to the outline guard in
 * `src/app/focus-ring.test.ts`. jsdom has no layout, so this pins which
 * element carries the ring.
 */
describe("TipAmountPicker focus", () => {
  it("rings each preset's label and the Other box (has-[:focus-visible]:focus-ring), and only the amount field inside switches its own outline off", () => {
    render(
      <TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="$" {...copy} />,
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveClass("sr-only");
      expect(radio.closest("label")).toHaveClass("has-[:focus-visible]:focus-ring");
    }
    const custom = screen.getByLabelText("Other tip amount");
    expect(custom).toHaveClass("focus:outline-none");
    expect(custom.closest("label")).toHaveClass("has-[:focus-visible]:focus-ring", "border");
  });
});
