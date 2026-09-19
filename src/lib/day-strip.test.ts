import { describe, expect, it } from "vitest";
import {
  dayStripGeometry,
  dayStripTicks,
  dayStripWindow,
  HORIZON_Y,
  VIEW_WIDTH,
} from "./day-strip";

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 7, 27, hour, minute));

const BASE = {
  from: at(6),
  to: at(22),
  now: at(10),
  sunriseAt: at(7),
  sunsetAt: at(19, 45),
  daylightProgress: 0.5,
};

/** The x a mark would land on if the window were split evenly — for readability below. */
const CENTRE = VIEW_WIDTH / 2;

describe("the window", () => {
  it("puts the middle of the window in the middle of the picture", () => {
    const geometry = dayStripGeometry({ ...BASE, marks: [{ id: "noon", at: at(14) }] });
    expect(geometry.marks[0].x).toBeCloseTo(CENTRE, 0);
  });

  it("drops a mark outside the window rather than pinning it to the edge", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      marks: [
        { id: "yesterday", at: at(2) },
        { id: "today", at: at(9) },
        { id: "tomorrow", at: at(23) },
      ],
    });
    expect(geometry.marks.map((mark) => mark.id)).toEqual(["today"]);
  });

  it("clips a band to the window it overlaps", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      bands: [{ id: "overnight", from: at(4), to: at(8) }],
    });
    const [band] = geometry.bands;
    expect(band.from).toBeLessThan(band.to);
    expect(band.from).toBeCloseTo(10, 0); // the left inset, not a negative x
  });

  it("keeps no band that ends before the window opens", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      bands: [{ id: "last night", from: at(1), to: at(3) }],
    });
    expect(geometry.bands).toEqual([]);
  });

  it("has no now line when now is not in the window", () => {
    expect(dayStripGeometry({ ...BASE, now: at(23) }).nowX).toBe(null);
    expect(dayStripGeometry(BASE).nowX).not.toBe(null);
  });

  /**
   * A window with no width is a division by zero in every coordinate below, and
   * `NaN` in a `d` attribute renders as nothing with no error anywhere — the
   * exact failure a reader cannot report. The empty day is the honest answer.
   */
  it("answers an empty day rather than NaN coordinates", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      from: at(9),
      to: at(9),
      marks: [{ id: "x", at: at(9) }],
    });
    expect(geometry.sunArc).toBe(null);
    expect(geometry.marks).toEqual([]);
    expect(geometry.nowX).toBe(null);
  });
});

describe("the sun", () => {
  it("arcs from its own rise to its own set", () => {
    const geometry = dayStripGeometry(BASE);
    expect(geometry.sunArc).toMatch(/^M[\d.]+,100 Q[\d.-]+,[\d.-]+ [\d.]+,100$/);
  });

  it("reaches the top of the arc at the middle of the daylight", () => {
    const { sun } = dayStripGeometry({ ...BASE, daylightProgress: 0.5 });
    const midday = dayStripGeometry({ ...BASE, daylightProgress: 0.5 });
    expect(sun).not.toBe(null);
    // The apex, not the control point: a Bézier reaches half way to its control.
    expect(midday.sun?.y).toBeCloseTo(26, 0);
  });

  it("sits on the horizon at sunrise and at sunset", () => {
    expect(dayStripGeometry({ ...BASE, daylightProgress: 0 }).sun?.y).toBeCloseTo(HORIZON_Y, 0);
    expect(dayStripGeometry({ ...BASE, daylightProgress: 1 }).sun?.y).toBeCloseTo(HORIZON_Y, 0);
  });

  it("is not drawn at all while it is down", () => {
    const geometry = dayStripGeometry({ ...BASE, daylightProgress: null });
    expect(geometry.sun).toBe(null);
    expect(geometry.sunArcElapsed).toBe(null);
    // The arc itself stays: the day still had a sun in it.
    expect(geometry.sunArc).not.toBe(null);
  });

  it("draws no arc where the sun does not cross", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      sunriseAt: null,
      sunsetAt: null,
      daylightProgress: null,
    });
    expect(geometry.sunArc).toBe(null);
    expect(geometry.sun).toBe(null);
  });

  it("walks the elapsed arc only as far as the sun has gone", () => {
    const early = dayStripGeometry({ ...BASE, daylightProgress: 0.1 });
    const late = dayStripGeometry({ ...BASE, daylightProgress: 0.9 });
    expect(early.sunArcElapsed?.length).toBeLessThan(late.sunArcElapsed?.length ?? 0);
    expect(early.sunArcElapsed?.startsWith("M")).toBe(true);
  });
});

describe("the tide", () => {
  it("curves through its turns", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      tideTurns: [
        { at: at(9, 12), kind: "high" },
        { at: at(15, 31), kind: "low" },
        { at: at(21, 36), kind: "high" },
      ],
    });
    expect(geometry.tidePath).toMatch(/^M[\d.]+,\d+( C[\d.,\s-]+)+$/);
    expect(geometry.tidePath?.match(/C/g)).toHaveLength(2);
  });

  /**
   * The curve has to *enter* the frame at the right height, so the last turn
   * before the window stays in the path. Dropping it made an ebb that began at
   * four in the morning look like a rise at six.
   */
  it("keeps the turn either side of the window so the curve enters level", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      tideTurns: [
        { at: at(3), kind: "low" },
        { at: at(9), kind: "high" },
        { at: at(23, 30), kind: "low" },
      ],
    });
    expect(geometry.tidePath?.match(/C/g)).toHaveLength(2);
  });

  it("draws nothing with fewer than two turns to draw between", () => {
    expect(dayStripGeometry({ ...BASE, tideTurns: [{ at: at(9), kind: "high" }] }).tidePath).toBe(
      null,
    );
    expect(dayStripGeometry(BASE).tidePath).toBe(null);
  });

  it("puts a high above a low", () => {
    const geometry = dayStripGeometry({
      ...BASE,
      tideTurns: [
        { at: at(9), kind: "high" },
        { at: at(15), kind: "low" },
      ],
    });
    const ys = [...(geometry.tidePath ?? "").matchAll(/,(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys));
  });
});

describe("ticks", () => {
  it("places each tick on its own instant and drops the ones outside", () => {
    const geometry = dayStripGeometry({ ...BASE, ticks: [at(6), at(14), at(22), at(23)] });
    expect(geometry.ticks).toHaveLength(3);
    expect(geometry.ticks[1].x).toBeCloseTo(CENTRE, 0);
    expect(geometry.ticks[0].at).toEqual(at(6));
  });
});

const DAY_FROM = new Date(Date.UTC(2026, 7, 27, 0));
const DAY_TO = new Date(Date.UTC(2026, 7, 28, 0));
/** Every hour boundary of that day, which is what `dayStripTicks` chooses from. */
const DAY_HOURS = Array.from({ length: 24 }, (_, hour) => at(hour));
const hours = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 3_600_000;

describe("the part of the day worth drawing", () => {
  const BOUNDS = { dayFrom: DAY_FROM, dayTo: DAY_TO };

  it("frames the sun and the boats rather than midnight to midnight", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(10),
      sunriseAt: at(7),
      sunsetAt: at(19, 45),
      marks: [at(7), at(8)],
    });
    // 45 minutes either side of the earliest thing and the latest.
    expect(window.from).toEqual(at(6, 15));
    expect(window.to).toEqual(at(20, 30));
  });

  it("opens before a boat that leaves before first light", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(6),
      sunriseAt: at(7),
      sunsetAt: at(19, 45),
      marks: [at(5, 30)],
    });
    expect(window.from).toEqual(at(4, 45));
  });

  /**
   * A day whose boats are all in the morning should not stretch to 11 PM
   * because that is when it is being read — but the now line has to be *in* the
   * picture, or the strip is of some other day.
   */
  it("reaches now without being led by it", () => {
    const morning = dayStripWindow({
      ...BOUNDS,
      now: at(21),
      sunriseAt: null,
      sunsetAt: null,
      marks: [at(7)],
    });
    expect(morning.from).toEqual(at(6, 15));
    expect(morning.to).toEqual(at(21));

    const beforeDawn = dayStripWindow({
      ...BOUNDS,
      now: at(4),
      sunriseAt: at(7),
      sunsetAt: at(19, 45),
      marks: [],
    });
    expect(beforeDawn.from).toEqual(at(4));
  });

  it("never leaves the shop's own day", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(12),
      sunriseAt: at(0, 10),
      sunsetAt: at(23, 50),
      marks: [],
    });
    expect(window.from).toEqual(DAY_FROM);
    expect(window.to).toEqual(DAY_TO);
  });

  /** One boat and four hours of sun is a winter day, not a reason to zoom in. */
  it("grows a window too narrow to read", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(12),
      sunriseAt: at(11),
      sunsetAt: at(13),
      marks: [at(12)],
    });
    expect(hours(window.from, window.to)).toBe(6);
    // Grown from the middle, so the sun still sits in the centre of it.
    expect(window.from).toEqual(at(9));
    expect(window.to).toEqual(at(15));
  });

  it("slides a grown window off the day's edge rather than over it", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(1),
      sunriseAt: null,
      sunsetAt: null,
      marks: [at(0, 30)],
    });
    expect(window.from).toEqual(DAY_FROM);
    expect(hours(window.from, window.to)).toBe(6);
  });

  it("draws the whole day when there is neither a sun nor a boat", () => {
    const window = dayStripWindow({
      ...BOUNDS,
      now: at(12),
      sunriseAt: null,
      sunsetAt: null,
      marks: [],
    });
    expect(window.from).toEqual(DAY_FROM);
    expect(window.to).toEqual(DAY_TO);
  });
});

describe("the ticks", () => {
  /**
   * "8 AM · 12 PM · 3 PM · 7 PM" is a picture whose spacing has to be worked
   * out. Every tick sits a whole number of hours from the last one.
   */
  it("picks one even stride across the window", () => {
    const ticks = dayStripTicks({
      from: at(6, 15),
      to: at(20, 30),
      hours: DAY_HOURS,
      count: 4,
    });
    expect(ticks).toHaveLength(4);
    const gaps = ticks.slice(1).map((tick, index) => hours(ticks[index], tick));
    expect(new Set(gaps).size).toBe(1);
  });

  it("tightens the stride on a short window and loosens it on a long one", () => {
    const short = dayStripTicks({ from: at(9), to: at(15), hours: DAY_HOURS, count: 4 });
    const long = dayStripTicks({ from: DAY_FROM, to: DAY_TO, hours: DAY_HOURS, count: 4 });
    expect(short.length).toBeLessThanOrEqual(4);
    expect(long.length).toBeLessThanOrEqual(4);
    expect(hours(short[0], short[1])).toBeLessThan(hours(long[0], long[1]));
  });

  it("keeps every tick inside the window, off its edges", () => {
    const from = at(6, 15);
    const to = at(20, 30);
    for (const tick of dayStripTicks({ from, to, hours: DAY_HOURS, count: 4 })) {
      expect(tick.getTime()).toBeGreaterThan(from.getTime());
      expect(tick.getTime()).toBeLessThan(to.getTime());
    }
  });

  it("says nothing rather than guessing when no hour fits", () => {
    expect(dayStripTicks({ from: at(6, 5), to: at(6, 50), hours: DAY_HOURS })).toEqual([]);
  });
});
