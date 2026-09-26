// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayStripGeometry } from "@/lib/day-strip";
import { DayStrip } from "./DayStrip";

afterEach(cleanup);

/** How many rows the mark labels are spread over — one, or two when they would touch. */
const labelRows = (container: HTMLElement): number =>
  new Set(
    [...container.querySelectorAll("span")]
      .filter((node) => node.textContent)
      .map((node) => /-translate-y-\[[^\]]+\]/.exec(node.className)?.[0]),
  ).size;

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 7, 27, hour, minute));

const geometry = dayStripGeometry({
  from: at(6),
  to: at(22),
  now: at(10, 40),
  daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
  daylightProgress: 0.29,
  marks: [
    { id: "morning", at: at(7) },
    { id: "afternoon", at: at(13) },
    { id: "night", at: at(19, 30) },
  ],
  ticks: [at(6), at(12), at(18)],
  tideTurns: [
    { at: at(9), kind: "high" },
    { at: at(15), kind: "low" },
  ],
});

describe("DayStrip", () => {
  it("is one image with the caller's sentence for a reader who cannot see it", () => {
    const { container } = render(
      <DayStrip geometry={geometry} label="Three boats today, under a rising sun." />,
    );
    const image = screen.getByRole("img", { name: "Three boats today, under a rising sun." });
    expect(image).toBe(container.firstElementChild);
    // The curves are decoration inside that one image, never a second one.
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  /**
   * Every word on the strip is a real element at a real size, not glyphs in a
   * stretched viewBox: the same 11-unit `<text>` renders at four pixels on a
   * phone and eleven on a desk, and the phone is where a crew reads it.
   */
  const words = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("span")]
      .map((node) => node.textContent)
      .filter((text) => text !== "");

  /**
   * The component says no word of its own: a staff surface's copy comes from
   * the message bundle and a rendered time is in the shop's zone, and neither
   * of those is knowable here.
   */
  it("prints only the words it was handed", () => {
    const { container } = render(
      <DayStrip
        geometry={geometry}
        label="the day"
        markLabels={{ morning: "7:00", afternoon: "1:00 PM", night: "7:30 PM" }}
        tickLabels={["6 AM", "12", "6 PM"]}
        nowLabel="10:40"
      />,
    );
    // No `<text>` at all — every label is an element the browser sizes.
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(words(container)).toEqual(
      expect.arrayContaining(["7:00", "1:00 PM", "7:30 PM", "6 AM", "12", "6 PM", "10:40"]),
    );
    // Nothing else: no month, no "today", no unit it invented.
    expect(words(container)).toHaveLength(7);
  });

  /**
   * A dot has to be round at 390 and at 976, which a circle in a
   * `preserveAspectRatio="none"` viewBox is not — it is an egg standing on end
   * at one width and lying down at the other.
   */
  it("draws every mark and the sun round rather than as a stretched circle", () => {
    const { container } = render(<DayStrip geometry={geometry} label="the day" />);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    // Three marks and the sun, which is the fourth.
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(4);
  });

  it("raises a label that would touch the one before it", () => {
    const crowded = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(10),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: 0.2,
      marks: [
        { id: "first", at: at(7) },
        { id: "second", at: at(7, 30) },
      ],
    });
    const { container } = render(
      <DayStrip
        geometry={crowded}
        label="the day"
        markLabels={{ first: "7:00", second: "7:30" }}
      />,
    );
    expect(labelRows(container)).toBe(2);
  });

  /**
   * **A long word needs more room than a time.** The clamp that keeps a label
   * off the strip's edges holds its centre half a word in, and that half used
   * to be a fixed figure tuned for "11:00 AM" — too little for a dive labelled
   * with its site. "Molasses Reef" clears a 390px phone's left edge by about
   * seven pixels today, and only because that mark sits far enough in; one
   * arriving at the very start of the window would lose its first letters.
   */
  it("holds a long label further from the edge than a short one", () => {
    const edge = dayStripGeometry({
      from: at(7),
      to: at(19),
      now: at(10),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: 0.2,
      marks: [{ id: "first", at: at(7) }],
    });
    const roomOf = (label: string): string => {
      cleanup();
      const { container } = render(
        <DayStrip geometry={edge} label="the day" markLabels={{ first: label }} />,
      );
      const node = [...container.querySelectorAll("span")].find(
        (span) => span.textContent === label,
      );
      return node?.getAttribute("style") ?? "";
    };
    expect(roomOf("7:00")).toContain("clamp(1.75rem");
    // Thirteen characters at about 6.3px each is 82px of word, so the clamp
    // opens to half of it rather than letting the first letters hang outside.
    expect(roomOf("Molasses Reef")).toContain("clamp(2.60rem");
  });

  /**
   * **Only a word can collide with a word** (docs/design/pixel-craft.md,
   * class 4). The trip page draws its lines-off mark with no label, and the
   * first dive's label climbed a row to dodge it: "Molasses Reef" 14–15px
   * above "6:00 PM", with the only other labelled mark 888px away
   * (trip-crew-clash, trip-guests, trip-manage). A mark that draws no word
   * takes no part in the collision.
   */
  it("does not raise a label to clear a mark that has none", () => {
    const linesOff = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(10),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: 0.2,
      marks: [
        { id: "lines-off", at: at(7) },
        { id: "first-dive", at: at(7, 30) },
      ],
    });
    const { container } = render(
      <DayStrip
        geometry={linesOff}
        label="the day"
        markLabels={{ "first-dive": "Molasses Reef" }}
      />,
    );
    const word = [...container.querySelectorAll("span")].find(
      (span) => span.textContent === "Molasses Reef",
    );
    expect(word?.className).toContain("-translate-y-[calc(100%+0.625rem)]");
    expect(word?.className).not.toContain("-translate-y-[calc(100%+1.5rem)]");
  });

  it("still raises the second of two labelled marks with an unlabelled one between them", () => {
    const crowded = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(10),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: 0.2,
      marks: [
        { id: "first", at: at(7) },
        { id: "unlabelled", at: at(7, 15) },
        { id: "second", at: at(7, 30) },
      ],
    });
    const { container } = render(
      <DayStrip
        geometry={crowded}
        label="the day"
        markLabels={{ first: "7:00", second: "7:30" }}
      />,
    );
    expect(labelRows(container)).toBe(2);
  });

  /**
   * **An end dot stays inside the strip** (docs/design/pixel-craft.md, class
   * 10). The geometry's inset is in viewBox units, 1% of the width, which is
   * 9.8px on a desk and 3.6px on a phone, while the dot is 11px at every
   * width: at 390 the first dot hung 2px past the column the header's
   * "‹ BOARD" and title start on, and the last 1px past its end. The dot's
   * centre is held half a dot in, as a label's is held half a word in.
   */
  it("holds a mark's dot half a dot in from the strip's ends", () => {
    const edge = dayStripGeometry({
      from: at(7),
      to: at(19),
      now: at(10),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: 0.2,
      marks: [{ id: "first", at: at(7) }],
    });
    const { container } = render(<DayStrip geometry={edge} label="the day" />);
    const dot = container.querySelector("span.size-\\[11px\\]");
    expect(dot?.getAttribute("style")).toContain("clamp(5.5px,");
  });

  it("leaves both labels on one line when they do not touch", () => {
    const { container } = render(
      <DayStrip
        geometry={geometry}
        label="the day"
        markLabels={{ morning: "7:00", afternoon: "1:00 PM", night: "7:30 PM" }}
      />,
    );
    expect(labelRows(container)).toBe(1);
  });

  it("draws no now line on a day that does not contain now", () => {
    const past = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(23),
      daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
      daylightProgress: null,
    });
    const { container } = render(
      <DayStrip geometry={past} label="yesterday" nowLabel="11:00 PM" />,
    );
    expect(words(container)).not.toContain("11:00 PM");
  });

  /**
   * Every colour is a token. A hex here would be invisible to the night palette
   * and to the crew's glare mode, which is exactly the failure `check:tokens`
   * exists to refuse.
   */
  it("reaches for tokens and never a colour of its own", () => {
    const { container } = render(<DayStrip geometry={geometry} label="the day" />);
    const markup = container.innerHTML;
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(markup).toContain("(--sky-ink)");
  });
});
