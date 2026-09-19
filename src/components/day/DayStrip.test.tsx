// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayStripGeometry } from "@/lib/day-strip";
import { DayStrip } from "./DayStrip";

afterEach(cleanup);

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 7, 27, hour, minute));

const geometry = dayStripGeometry({
  from: at(6),
  to: at(22),
  now: at(10, 40),
  sunriseAt: at(7),
  sunsetAt: at(19, 45),
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
    render(<DayStrip geometry={geometry} label="Three boats today, under a rising sun." />);
    const image = screen.getByRole("img", { name: "Three boats today, under a rising sun." });
    expect(image.tagName.toLowerCase()).toBe("svg");
  });

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
    const words = [...container.querySelectorAll("text")].map((node) => node.textContent);
    expect(words).toEqual(
      expect.arrayContaining(["7:00", "1:00 PM", "7:30 PM", "6 AM", "12", "6 PM", "10:40"]),
    );
    // Nothing else: no month, no "today", no unit it invented.
    expect(words).toHaveLength(7);
  });

  it("draws a dot for every mark inside the window", () => {
    const { container } = render(<DayStrip geometry={geometry} label="the day" />);
    // Three marks and the sun, which is the fourth circle.
    expect(container.querySelectorAll("circle")).toHaveLength(4);
  });

  it("raises a label that would touch the one before it", () => {
    const crowded = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(10),
      sunriseAt: at(7),
      sunsetAt: at(19, 45),
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
    const ys = [...container.querySelectorAll("text")].map((node) =>
      Number(node.getAttribute("y")),
    );
    expect(new Set(ys).size).toBe(2);
  });

  it("leaves both labels on one line when they do not touch", () => {
    const { container } = render(
      <DayStrip
        geometry={geometry}
        label="the day"
        markLabels={{ morning: "7:00", afternoon: "1:00 PM", night: "7:30 PM" }}
      />,
    );
    const ys = [...container.querySelectorAll("text")].map((node) =>
      Number(node.getAttribute("y")),
    );
    expect(new Set(ys).size).toBe(1);
  });

  it("draws no now line on a day that does not contain now", () => {
    const past = dayStripGeometry({
      from: at(6),
      to: at(22),
      now: at(23),
      sunriseAt: at(7),
      sunsetAt: at(19, 45),
      daylightProgress: null,
    });
    const { container } = render(
      <DayStrip geometry={past} label="yesterday" nowLabel="11:00 PM" />,
    );
    expect(container.querySelector("rect")).toBe(null);
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
    expect(markup).toContain("var(--sky-ink)");
  });
});
