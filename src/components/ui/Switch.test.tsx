// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Switch } from "./Switch";

afterEach(cleanup);

/**
 * The one sliding on/off control (issue #1122's sibling, #1322). Two surfaces
 * drew this by hand with byte-identical class strings; what this file pins is
 * the half a class string cannot state — that it is one control, named by its
 * own label, reachable by keyboard, and reported to assistive technology as a
 * switch rather than as a checkbox.
 */
describe("Switch", () => {
  it("is one switch, named by the words beside it", () => {
    render(<Switch checked={false} onChange={() => {}} label="Keep the screen awake" />);
    const control = screen.getByRole("switch", { name: "Keep the screen awake" });
    expect(control).toBeInTheDocument();
    // A checkbox drawn as a switch must not also be findable as a checkbox —
    // that is how a screen-reader user hears "checkbox, not checked" for a
    // setting that has already taken effect.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("reports its state, and keeps aria-checked with it", () => {
    const { rerender } = render(<Switch checked={false} onChange={() => {}} label="Vibrate" />);
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    rerender(<Switch checked onChange={() => {}} label="Vibrate" />);
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("hands back the new value, not an event", async () => {
    // The two call sites both want the boolean and nothing else — one writes
    // it to localStorage, one to a device preference — so the prop is the
    // value rather than a change event to unwrap at each of them.
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Vibrate" />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles from the label's words, not only from the track", async () => {
    // The whole control is a `<label>`, which is what makes the words a tap
    // target as well as the accessible name — the difference between a 44px
    // switch and a 44px switch with a sentence beside it that does nothing.
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Vibrate" />);
    await userEvent.click(screen.getByText("Vibrate"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("takes the keyboard, since a switch is a control and not a decoration", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Vibrate" />);
    await userEvent.tab();
    expect(screen.getByRole("switch")).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps the dock-test target and stays off paper", () => {
    const { container } = render(<Switch checked={false} onChange={() => {}} label="Vibrate" />);
    const label = container.querySelector("label");
    // 44px and `print:hidden` are the two rules a call site would otherwise
    // have to remember, and the two that went missing when this was a class
    // string copied between files.
    expect(label?.className).toContain("min-h-11");
    expect(label?.className).toContain("print:hidden");
  });
});
