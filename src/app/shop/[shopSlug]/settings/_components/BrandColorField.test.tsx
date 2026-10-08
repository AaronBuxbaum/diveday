// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR, parseBrandColor } from "@/lib/brand";
import { BrandColorField } from "./BrandColorField";

afterEach(cleanup);

const renderField = (initial: string | null = null) =>
  render(
    <BrandColorField initial={initial} pickerLabel="Pick a color" placeholder="Brand color" />,
  );

const picker = () => screen.getByLabelText("Pick a color") as HTMLInputElement;
const hexField = () => screen.getByPlaceholderText("Brand color") as HTMLInputElement;

/** What Save stores for a typed value: the server's own normalization. */
const saved = (typed: string) => parseBrandColor(typed).value;

/**
 * **The picker previews what the server will save** (issue #1897). The hex
 * field accepts six digits with or without the `#`, and `parseBrandColor`
 * normalizes both to `#rrggbb`; a preview that only knew the `#` spelling
 * fell back to DiveDay's color for a value that would save as the shop's own.
 * The colors are spelled without the `#` because a raw hex literal under
 * `src/app` is refused by `check:tokens`.
 */
describe("BrandColorField", () => {
  it("previews a hex pasted without the #", () => {
    renderField();
    fireEvent.change(hexField(), { target: { value: "FF8800" } });
    expect(picker().value).toBe(saved("FF8800"));
    expect(picker().value).not.toBe(DIVEDAY_BRAND_COLOR);
    // The field keeps what the person typed; the server normalizes on save.
    expect(hexField().value).toBe("FF8800");
  });

  it("previews a stored color, which carries the #", () => {
    const stored = saved("12AB34");
    renderField(stored);
    expect(picker().value).toBe(stored);
  });

  it("falls back to DiveDay's color while the field is blank or not yet six digits", () => {
    renderField();
    expect(picker().value).toBe(DIVEDAY_BRAND_COLOR);
    fireEvent.change(hexField(), { target: { value: "ff88" } });
    expect(picker().value).toBe(DIVEDAY_BRAND_COLOR);
  });
});
