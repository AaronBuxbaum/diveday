/**
 * **The day, as geometry** — ADR 20260919-one-idea, decision I · Tide.
 *
 * Tide draws one picture at the top of every day-shaped surface: the sun's arc
 * over a horizon, the tide breathing under it, the shop's departures sitting on
 * the hours they leave, and a line for now. This module turns the day's facts
 * into the numbers that picture is made of, and does nothing else — no colour,
 * no words, no element. `SkyBand` and `DayStrip` place what comes out.
 *
 * **Why a module and not a component.** The same picture is drawn at three
 * scales — a whole day on the home, a voyage on a departure, a week on the
 * board — and each is the same arithmetic over a different window. Written in
 * the component it would be written three times and tested none, and the one
 * thing that makes it worth drawing at all is that the hours are *true*: a boat
 * mark two pixels off its hour is a picture that lies about the morning.
 *
 * **It informs and gates nothing**, exactly like the almanac it reads from. No
 * rule in `readiness.ts`, `trip-admission.ts` or anywhere else consults a
 * coordinate produced here.
 *
 * Everything is in one viewBox-shaped space (`VIEW_WIDTH` × `VIEW_HEIGHT`) so a
 * caller can scale the whole strip with CSS and never recompute. Instants come
 * in as `Date`s and leave as x positions; anything outside the window is
 * dropped rather than clamped, because a mark pinned to the edge reads as a
 * departure at an hour it does not have.
 */

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 150;
/** The waterline the marks sit on and the sun rises from. */
export const HORIZON_Y = 100;
/** The top of the sun's arc at its highest — the apex of the quadratic. */
const ARC_APEX_Y = 26;
/** The tide curve's two extremes, below the horizon. */
const TIDE_HIGH_Y = VIEW_HEIGHT - 26;
const TIDE_LOW_Y = VIEW_HEIGHT - 6;
/** Inset so a mark's circle at either end is not clipped by the viewBox. */
const PAD_X = 10;

/**
 * How much room the window leaves either side of the first and last thing in
 * it. Enough that a 7:00 AM departure is not a dot on the left edge, and small
 * enough that the arc still fills the frame.
 */
const WINDOW_PAD_MS = 45 * 60 * 1000;
/**
 * The narrowest window worth drawing. Below this the hours are so close
 * together that the ticks collide and the picture reads as a zoom rather than
 * as a day — which happens on a winter day with one boat and four hours of sun.
 */
const MIN_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * **The part of the day worth drawing.**
 *
 * A strip spanning midnight to midnight spends half its width on night: the
 * arc is a flat wire in the middle and every boat is crowded into the same
 * third. So the window is the day's *content* — from the sun's rise and the
 * first departure to its set and the last, with room either side — clamped
 * inside the shop's own day and always containing now, because a picture of
 * today with no now in it is a picture of some other day.
 *
 * Falls back to the whole day where there is neither a sun nor a boat: nothing
 * to frame, so frame everything.
 */
export function dayStripWindow(input: {
  /** The shop's own day, midnight to midnight — the widest the window may be. */
  dayFrom: Date;
  dayTo: Date;
  now: Date;
  sunriseAt: Date | null;
  sunsetAt: Date | null;
  /** Every instant that has to be inside the frame — departures, usually. */
  marks?: readonly Date[];
}): { from: Date; to: Date } {
  const dayFrom = input.dayFrom.getTime();
  const dayTo = input.dayTo.getTime();
  if (!(dayTo > dayFrom)) return { from: input.dayFrom, to: input.dayTo };

  const wanted: number[] = [];
  if (input.sunriseAt) wanted.push(input.sunriseAt.getTime() - WINDOW_PAD_MS);
  if (input.sunsetAt) wanted.push(input.sunsetAt.getTime() + WINDOW_PAD_MS);
  for (const mark of input.marks ?? []) {
    wanted.push(mark.getTime() - WINDOW_PAD_MS, mark.getTime() + WINDOW_PAD_MS);
  }
  if (wanted.length === 0) return { from: input.dayFrom, to: input.dayTo };

  // Now is not "wanted" in its own right — a day whose boats are all in the
  // morning should not stretch to 11 PM just because that is when it is being
  // read — but it must be *inside*, or the now line vanishes from a picture of
  // today. Widening to reach it is the smallest change that keeps both.
  const nowAt = Math.min(Math.max(input.now.getTime(), dayFrom), dayTo);
  wanted.push(nowAt);

  let from = Math.max(dayFrom, Math.min(...wanted));
  let to = Math.min(dayTo, Math.max(...wanted));
  // Grow a too-narrow window from its middle, then slide whatever the day's
  // edges refuse onto the other side, so the result is never under the minimum
  // while the day itself is over it.
  if (to - from < MIN_WINDOW_MS) {
    const middle = (from + to) / 2;
    from = middle - MIN_WINDOW_MS / 2;
    to = middle + MIN_WINDOW_MS / 2;
    if (from < dayFrom) {
      to += dayFrom - from;
      from = dayFrom;
    }
    if (to > dayTo) {
      from -= to - dayTo;
      to = dayTo;
    }
    from = Math.max(dayFrom, from);
    to = Math.min(dayTo, to);
  }
  return { from: new Date(from), to: new Date(to) };
}

/**
 * The strides a clock is read in. Every hour, every two, every three — never
 * every five, because "8 AM · 1 PM · 6 PM" is a picture whose spacing has to be
 * worked out, and the whole point of the ticks is that it does not.
 */
const TICK_STRIDES = [1, 2, 3, 4, 6, 8, 12] as const;

/**
 * The hours to draw a tick under: the day's own hour marks, at the tightest
 * even stride that fits `count` of them inside the window.
 *
 * The caller supplies the hours as instants because "the top of the hour" is a
 * wall-clock fact in the shop's zone, and this module reads no zone — it reads
 * only each hour's place in the day, which is its index in the array. What it
 * decides is the stride: four ticks across a six-hour window and four across a
 * sixteen-hour one, so the strip's rhythm does not change with the season.
 */
export function dayStripTicks(input: {
  from: Date;
  to: Date;
  /** Every hour boundary of the day, in order from its first hour. */
  hours: readonly Date[];
  count?: number;
}): Date[] {
  const count = input.count ?? 4;
  const from = input.from.getTime();
  const to = input.to.getTime();
  // In from each edge, because a tick under the very first pixel is a label
  // with nowhere to be centred.
  const inset = (to - from) * 0.06;
  const inside = input.hours
    .map((at, index) => ({ at, index }))
    .filter(({ at }) => at.getTime() >= from + inset && at.getTime() <= to - inset);
  if (inside.length <= count) return inside.map((hour) => hour.at);
  for (const stride of TICK_STRIDES) {
    const picked = inside.filter(({ index }) => index % stride === 0);
    if (picked.length > 0 && picked.length <= count) return picked.map((hour) => hour.at);
  }
  // Every stride overshot, which takes a window wider than a day: one tick in
  // the middle says more than none.
  return [inside[Math.floor(inside.length / 2)].at];
}

export type StripMark = { id: string; at: Date };
export type StripBand = { id: string; from: Date; to: Date };
export type TideTurn = { at: Date; kind: "high" | "low" };

export type DayStripInput = {
  /** The window the strip spans, left edge to right edge. */
  from: Date;
  to: Date;
  now: Date;
  sunriseAt: Date | null;
  sunsetAt: Date | null;
  /** Where the sun is between its own rise and set, 0-1, from `skyReadingFor`. */
  daylightProgress: number | null;
  /** The day's predicted turns of the tide, in any order. */
  tideTurns?: readonly TideTurn[];
  /** Departures, or any moment worth a dot on the horizon. */
  marks?: readonly StripMark[];
  /** Spans worth a thick line on the horizon — a dive, a voyage. */
  bands?: readonly StripBand[];
  /** Instants to draw a tick under; the caller words them. */
  ticks?: readonly Date[];
};

export type DayStripGeometry = {
  width: number;
  height: number;
  horizonY: number;
  /** The whole arc from sunrise to sunset, or null where the sun does not cross. */
  sunArc: string | null;
  /** The part of it already walked, or null before sunrise. */
  sunArcElapsed: string | null;
  /** Where the sun is now, or null when it is down. */
  sun: { x: number; y: number } | null;
  /** The tide through the window, or null with fewer than two turns in it. */
  tidePath: string | null;
  marks: { id: string; x: number }[];
  bands: { id: string; from: number; to: number }[];
  ticks: { at: Date; x: number }[];
  /** Now, or null when now is outside the window — a strip of a past day has none. */
  nowX: number | null;
};

/** The day's picture, in one viewBox-shaped space. */
export function dayStripGeometry(input: DayStripInput): DayStripGeometry {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const span = to - from;
  // A window with no width has no picture in it, and every x below would be a
  // division by zero. Answer with the empty day rather than NaN coordinates.
  if (!(span > 0)) return emptyGeometry();

  const x = (at: number): number => PAD_X + ((at - from) / span) * (VIEW_WIDTH - PAD_X * 2);
  const inside = (at: number): boolean => at >= from && at <= to;

  const sunrise = input.sunriseAt?.getTime() ?? null;
  const sunset = input.sunsetAt?.getTime() ?? null;
  const hasArc = sunrise !== null && sunset !== null && sunset > sunrise;

  // A quadratic whose ends sit on the horizon and whose midpoint reaches the
  // apex. A Bézier's control point is not its midpoint: at t=0.5 the curve
  // reaches a quarter of each end plus half the control, so the control has to
  // be pushed twice as far to land the top of the arc where it is wanted.
  const arcStartX = hasArc ? x(sunrise) : 0;
  const arcEndX = hasArc ? x(sunset) : 0;
  const arcMidX = (arcStartX + arcEndX) / 2;
  const controlY = 2 * ARC_APEX_Y - HORIZON_Y;
  const pointAt = (progress: number): { x: number; y: number } => {
    const t = Math.min(1, Math.max(0, progress));
    const inverse = 1 - t;
    return {
      x: inverse * inverse * arcStartX + 2 * inverse * t * arcMidX + t * t * arcEndX,
      y: inverse * inverse * HORIZON_Y + 2 * inverse * t * controlY + t * t * HORIZON_Y,
    };
  };

  const progress = input.daylightProgress;
  const sunUp = hasArc && progress !== null && progress >= 0 && progress <= 1;

  return {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    horizonY: HORIZON_Y,
    sunArc: hasArc
      ? `M${round(arcStartX)},${HORIZON_Y} Q${round(arcMidX)},${round(controlY)} ${round(arcEndX)},${HORIZON_Y}`
      : null,
    sunArcElapsed: sunUp ? elapsedArc(pointAt, progress) : null,
    sun: sunUp ? roundPoint(pointAt(progress)) : null,
    tidePath: tidePath(input.tideTurns ?? [], x, from, to),
    marks: (input.marks ?? [])
      .filter((mark) => inside(mark.at.getTime()))
      .map((mark) => ({ id: mark.id, x: round(x(mark.at.getTime())) })),
    bands: (input.bands ?? [])
      .filter((band) => band.to.getTime() > from && band.from.getTime() < to)
      .map((band) => ({
        id: band.id,
        from: round(x(Math.max(from, band.from.getTime()))),
        to: round(x(Math.min(to, band.to.getTime()))),
      })),
    ticks: (input.ticks ?? [])
      .filter((at) => inside(at.getTime()))
      .map((at) => ({ at, x: round(x(at.getTime())) })),
    nowX: inside(input.now.getTime()) ? round(x(input.now.getTime())) : null,
  };
}

/**
 * The walked part of the arc, as a polyline rather than a clipped curve.
 *
 * Splitting a quadratic at a parameter is de Casteljau's algorithm and would be
 * exact, but the whole arc is under 900 units wide and 24 segments put every
 * vertex inside a pixel of the true curve at any size this is ever drawn — and
 * a polyline is a shape a reader can check against the arc behind it by eye,
 * which a second set of control points is not.
 */
function elapsedArc(
  pointAt: (progress: number) => { x: number; y: number },
  progress: number,
): string {
  const steps = 24;
  const points: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const point = pointAt((progress * step) / steps);
    points.push(`${round(point.x)},${round(point.y)}`);
  }
  return `M${points.join(" L")}`;
}

/**
 * The tide as a smooth curve through its own turns.
 *
 * NOAA predicts the turns, not the shape between them, and the shape between
 * them is very nearly a sinusoid — so each pair of turns is one cubic whose
 * control points sit flat at either end, which is what makes a high read as a
 * crest that pauses rather than a corner. Turns outside the window are kept in
 * the path deliberately: the curve has to enter and leave the frame at the
 * right height, and dropping the turn before dawn is what made an early ebb
 * look like a rise.
 */
function tidePath(
  turns: readonly TideTurn[],
  x: (at: number) => number,
  from: number,
  to: number,
): string | null {
  const sorted = [...turns].sort((a, b) => a.at.getTime() - b.at.getTime());
  const relevant = sorted.filter((turn, index) => {
    const at = turn.at.getTime();
    if (at >= from && at <= to) return true;
    // The last turn before the window and the first after it, and nothing else.
    const next = sorted[index + 1];
    const previous = sorted[index - 1];
    if (at < from) return next !== undefined && next.at.getTime() >= from;
    return previous !== undefined && previous.at.getTime() <= to;
  });
  if (relevant.length < 2) return null;
  const y = (kind: TideTurn["kind"]): number => (kind === "high" ? TIDE_HIGH_Y : TIDE_LOW_Y);
  let path = `M${round(x(relevant[0].at.getTime()))},${y(relevant[0].kind)}`;
  for (let index = 1; index < relevant.length; index += 1) {
    const previous = relevant[index - 1];
    const turn = relevant[index];
    const startX = x(previous.at.getTime());
    const endX = x(turn.at.getTime());
    const reach = (endX - startX) * 0.38;
    path += ` C${round(startX + reach)},${y(previous.kind)} ${round(endX - reach)},${y(turn.kind)} ${round(endX)},${y(turn.kind)}`;
  }
  return path;
}

function emptyGeometry(): DayStripGeometry {
  return {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    horizonY: HORIZON_Y,
    sunArc: null,
    sunArcElapsed: null,
    sun: null,
    tidePath: null,
    marks: [],
    bands: [],
    ticks: [],
    nowX: null,
  };
}

/** One decimal is finer than any screen this is drawn on, and keeps the path readable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: round(point.x), y: round(point.y) };
}
