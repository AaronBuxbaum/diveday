// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { BrandColorField } from "./BrandColorField";

afterEach(cleanup);

const renderField = (initial: string | null = null) =>
  render(<BrandColorField initial={initial} pickerLabel="Pick a color" placeholder="#0064d2" />);

const picker = () => screen.getByLabelText("Pick a color") as HTMLInputElement;
const hexField = () => screen.getByPlaceholderText("#0064d2") as HTMLInputElement;

/**
 * **The picker previews what the server will save** (issue #1897). The hex
 * field accepts six digits with or without the `#`, and `parseBrandColor`
 * normalizes both to `#rrggbb`; a preview that only knew the `#` spelling
 * fell back to DiveDay's color for a value that would save as the shop's own.
 */
describe("BrandColorField", () => {
  it("previews a hex pasted without the #", () => {
    renderField();
    fireEvent.change(hexField(), { target: { value: "FF8800" } });
    expect(picker().value).toBe("#ff8800");
    // The field keeps what the person typed; the server normalizes on save.
    expect(hexField().value).toBe("FF8800");
  });

  it("previews a hex with the #", () => {
    renderField("#12ab34");
    expect(picker().value).toBe("#12ab34");
  });

  it("falls back to DiveDay's color while the field is blank or not yet six digits", () => {
    renderField();
    expect(picker().value).toBe(DIVEDAY_BRAND_COLOR);
    fireEvent.change(hexField(), { target: { value: "ff88" } });
    expect(picker().value).toBe(DIVEDAY_BRAND_COLOR);
  });
});
