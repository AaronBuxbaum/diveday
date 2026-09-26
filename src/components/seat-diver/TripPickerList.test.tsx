// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripPickerList } from "./TripPickerList";

afterEach(cleanup);

const OPTIONS = [
  {
    id: "reef",
    href: "/shop/blue-mantis/check-in/walk-in/reef",
    title: "Two-Tank Reef — Molasses & French",
    when: "11:00 AM – 2:30 PM",
    meta: "3/12",
  },
  {
    id: "wreck",
    href: "/shop/blue-mantis/check-in/walk-in/wreck",
    title: "Wreck Trip — Spiegel Grove",
    when: "1:00 PM – 5:30 PM",
    meta: "8/10",
  },
];

describe("the walk-in's departure picker", () => {
  it("makes every departure a door, named for it, with its seats beside it", () => {
    render(<TripPickerList options={OPTIONS} />);
    const reef = screen.getByRole("link", { name: /Two-Tank Reef/ });
    expect(reef).toHaveAttribute("href", "/shop/blue-mantis/check-in/walk-in/reef");
    expect(reef).toHaveTextContent("3/12");
  });

  /**
   * **No line starts with "·"** (pixel-craft class 8, K-525). The title and
   * the time were joined " · " with a breaking space before the dot, so at
   * 390 a long title wrapped and the second line opened on the separator. The
   * space before it is a no-break space, binding the dot to the title's last
   * word; the one after it still breaks, so the time may start a line.
   */
  it("binds each separator to the title before it", () => {
    render(<TripPickerList options={OPTIONS} />);
    for (const link of screen.getAllByRole("link")) {
      const text = link.textContent ?? "";
      const dots = [...text.matchAll(/(.)·(.)/g)];
      expect(dots, text).toHaveLength(1);
      for (const [, before, after] of dots) {
        expect(before, `the space before the dot in "${text}"`).toBe(" ");
        expect(after, `the space after the dot in "${text}"`).toBe(" ");
      }
    }
    // Raw `textContent`: jest-dom's `toHaveTextContent` folds U+00A0 into a
    // plain space, which is the one difference this asserts.
    expect(screen.getByRole("link", { name: /Two-Tank Reef/ }).textContent).toContain(
      "Two-Tank Reef — Molasses & French · 11:00 AM – 2:30 PM",
    );
  });
});
