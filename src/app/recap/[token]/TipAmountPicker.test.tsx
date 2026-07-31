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
    render(<TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="$" {...copy} />);
    expect(screen.getByText("$10")).toBeInTheDocument();
  });

  it("keeps a typed custom amount mutually exclusive with the presets", async () => {
    const user = userEvent.setup();
    render(<TipAmountPicker presets={[5, 10, 20]} defaultPreset={10} currencySymbol="$" {...copy} />);
    const custom = screen.getByLabelText("Other tip amount");
    await user.type(custom, "42");
    expect(custom).toHaveValue(42);
    const presetInputs = screen.getAllByRole("radio") as HTMLInputElement[];
    for (const input of presetInputs) expect(input.checked).toBe(false);
  });
});
