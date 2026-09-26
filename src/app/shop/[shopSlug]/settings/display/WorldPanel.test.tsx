// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorldPanel } from "./WorldPanel";

afterEach(cleanup);

const copy = {
  heading: "What the world can see",
  rowHeading: "Where each boat is in its day",
  detail: "A stage word a crew member tapped, and when.",
  valueOn: "On",
  valueOff: "Off",
  submit: "Save",
  submitting: "Saving…",
};

async function save() {}

/**
 * **The saved word sits on its row's line.** The row was `items-baseline`,
 * and its label is a flex box whose first item is the checkbox, whose baseline
 * is its bottom margin edge: "On" stood 3px below "Where each boat is in its
 * day" at 1280 and at 390 (K-440, SETTINGS-2-18). Both are one line in a 44px
 * row, so the row centres them.
 */
describe("the world panel's row", () => {
  it.each([true, false])("centres the label and the saved word (on: %s)", (on) => {
    render(<WorldPanel action={save} on={on} copy={copy} />);
    const row = screen.getByLabelText(copy.rowHeading).closest("label")?.parentElement;
    expect(row).toHaveClass("items-center");
    expect(row).not.toHaveClass("items-baseline");
    expect(row).toContainElement(screen.getByText(on ? copy.valueOn : copy.valueOff));
  });
});
