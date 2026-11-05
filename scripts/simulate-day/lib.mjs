/**
 * The pure half of the one-day simulation (`scripts/simulate-day.mjs`): when
 * each state of the day is reached on the frozen clock, and how the run is
 * written up. Nothing here touches a browser or a server, which is what makes
 * it unit-testable (`lib.test.mjs`) — the Playwright spec beside it
 * (`day.spec.ts`) does the driving and hands its findings back here.
 */

import { DAY_STATES as WORLD_DAY_STATES } from "../../src/lib/world.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long after a departure ties up its recap becomes due — the automatic
 * floor in `src/lib/recap-schedule.ts` (`RECAP_AUTOMATIC_DELAY_HOURS`). Spelled
 * here rather than imported so this module stays plain JavaScript a script can
 * load; `lib.test.mjs` pins it against the source of truth.
 */
export const RECAP_FLOOR_MS = 4 * HOUR_MS;

/**
 * How long after the last boat ties up the evening is photographed. The day
 * reads as over once every departure of the shop day is home with the standing
 * one-hour late-arrival buffer; a second hour keeps the simulation clear of
 * that boundary rather than sitting on it (the same margin
 * `evening` fact on `/api/test/shop` takes, for the same reason).
 */
export const EVENING_AFTER_MS = 2 * HOUR_MS;

/**
 * Every state the day must reach, in the order it is reached: the list lives in
 * `src/lib/world.ts`, which `pnpm check:route-coverage` reads too (issue #2752).
 * `day.spec.ts` walks it and refuses to skip a state, so a day that cannot reach
 * one fails at it by name.
 */
const DAY_LABELS = Object.freeze({
  "shop-open": "The shop opens on a fresh day",
  "seat-booked": "A diver books a seat on the public page",
  "waiver-signed": "The diver signs the waiver from the link",
  "card-added": "The diver adds their certification card from the link",
  "card-verified": "The counter sights the card and verifies it",
  "checked-in": "The counter checks the diver in",
  boarding: "The crew says the boat is boarding",
  "roll-call-departure": "Roll call before departure",
  underway: "Underway",
  "roll-call-after-dives": "Roll call after every dive",
  "heading-in": "Heading in",
  home: "Home",
  evening: "Every boat is home",
  "recap-sent": "The recap pass sends the diver's recap",
  "recap-read": "The diver reads the recap",
});

export const DAY_STATES = Object.freeze(
  WORLD_DAY_STATES.map(({ id }) => Object.freeze({ id, label: DAY_LABELS[id] })),
);

/**
 * When each state of the day happens on the simulated clock.
 *
 * Anchored on the departure the seed lays on the day's board, whose sail time
 * is `demoTodayDepartureStart` (five hours after the shop opens, rounded up
 * to the half hour) and whose length the seed fixes. Everything else is placed
 * relative to that window so the transcript reads like a real day: the diver
 * books at breakfast, the counter opens forty-five minutes before the boat
 * goes, roll calls sit one per dive, and the recap follows its floor.
 *
 * Every instant is monotone — the clock route refuses to step back, and a
 * timeline that asked it to would be a bug in the plan rather than the day.
 */
export function dayTimeline({ dayStart, sailAt, endsAt, plannedDives }) {
  const start = toMs(dayStart, "dayStart");
  const sail = toMs(sailAt, "sailAt");
  const end = toMs(endsAt, "endsAt");
  if (sail <= start) throw new Error("dayTimeline: the boat sails before the shop opens");
  if (end <= sail) throw new Error("dayTimeline: the boat ties up before it sails");
  const dives = Math.max(1, Math.min(4, Math.trunc(plannedDives)));

  // The checkpoints after each dive divide the time on the water evenly, with
  // the heading-in word after the last one.
  const onWater = end - sail;
  const afterDive = Array.from(
    { length: dives },
    (_, index) => sail + Math.round((onWater * (index + 1)) / (dives + 1)),
  );

  const at = {
    "shop-open": start,
    "seat-booked": start + 15 * MINUTE_MS,
    "waiver-signed": start + 30 * MINUTE_MS,
    "card-added": start + 45 * MINUTE_MS,
    "card-verified": sail - 50 * MINUTE_MS,
    "checked-in": sail - 45 * MINUTE_MS,
    boarding: sail - 15 * MINUTE_MS,
    "roll-call-departure": sail - 10 * MINUTE_MS,
    underway: sail,
    "roll-call-after-dives": afterDive,
    "heading-in": Math.max(afterDive[afterDive.length - 1] + 5 * MINUTE_MS, end - 30 * MINUTE_MS),
    home: end,
    evening: end + EVENING_AFTER_MS,
    "recap-sent": end + RECAP_FLOOR_MS + 5 * MINUTE_MS,
    "recap-read": end + RECAP_FLOOR_MS + 10 * MINUTE_MS,
  };

  const timeline = DAY_STATES.map((state) => {
    const value = at[state.id];
    const instants = Array.isArray(value) ? value : [value];
    return { ...state, at: instants.map((ms) => new Date(ms)) };
  });

  let previous = Number.NEGATIVE_INFINITY;
  for (const state of timeline) {
    for (const instant of state.at) {
      if (instant.getTime() < previous) {
        throw new Error(`dayTimeline: ${state.id} would move the clock backwards`);
      }
      previous = instant.getTime();
    }
  }
  return timeline;
}

/** `01-shop-open.png`: the screenshot a state leaves behind, zero-padded so a listing reads in order. */
export function screenshotName(index, id, suffix = "") {
  return `${String(index + 1).padStart(2, "0")}-${id}${suffix ? `-${suffix}` : ""}.png`;
}

const formatters = new Map();
function timeIn(instant, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

function elapsed(ms) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

/**
 * The run written up — `simulation/day.md`, the transcript V-04's rehearsal
 * asks a human to keep.
 *
 * One row per state: whether it was reached, at what simulated time (the shop's
 * own clock), how long the real machine took to get there, and the screenshot
 * it left. A state that failed keeps its error on the row, and every state
 * after it reads *not attempted* — the day stops at the first thing it cannot
 * do, and the transcript says so rather than reporting the rest as skipped
 * successes.
 */
export function renderTranscript({ shopSlug, timeZone, dayStart, startedAt, finishedAt, results }) {
  const reached = results.filter((row) => row.status === "reached").length;
  const failed = results.find((row) => row.status === "failed");
  const lines = [];
  lines.push("# One-day simulation");
  lines.push("");
  lines.push(
    `A fresh shop (\`${shopSlug}\`, ${timeZone}) driven through one dive day on the frozen clock, ` +
      `starting ${new Date(toMs(dayStart, "dayStart")).toISOString()}.`,
  );
  lines.push("");
  lines.push(
    failed
      ? `**Result: FAILED at "${failed.label}"** — ${reached} of ${results.length} states reached.`
      : reached === results.length
        ? `**Result: every state reached** — ${reached} of ${results.length}.`
        : `**Result: incomplete** — ${reached} of ${results.length} states reached; the run stopped before the rest were attempted.`,
  );
  lines.push("");
  lines.push(
    `Real time: ${elapsed(toMs(finishedAt, "finishedAt") - toMs(startedAt, "startedAt"))} ` +
      `(${new Date(toMs(startedAt, "startedAt")).toISOString()} → ${new Date(toMs(finishedAt, "finishedAt")).toISOString()}).`,
  );
  lines.push("");
  lines.push("| # | State | Shop time | Real elapsed | Screenshot | Note |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  results.forEach((row, index) => {
    const number = String(index + 1).padStart(2, "0");
    const state =
      row.status === "reached"
        ? row.label
        : row.status === "failed"
          ? `**${row.label}** — failed`
          : `${row.label} — not attempted`;
    const shopTime = row.simulatedAt
      ? timeIn(new Date(toMs(row.simulatedAt, "simulatedAt")), timeZone)
      : "";
    const real = row.realMs === undefined ? "" : elapsed(row.realMs);
    const shots = (row.screenshots ?? []).map((name) => `\`${name}\``).join(", ");
    const note = row.status === "failed" ? escapeCell(row.error ?? "") : escapeCell(row.note ?? "");
    lines.push(`| ${number} | ${state} | ${shopTime} | ${real} | ${shots} | ${note} |`);
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(text) {
  return (
    String(text)
      // Playwright colours its assertion messages; a transcript is read raw.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are exactly what this strips.
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\r?\n/g, " ")
      // **Backslashes first, or the pipe escape below eats its own.** A
      // Playwright assertion message carries them routinely -- a regex in a
      // locator, a Windows path. Escaping only the pipe turns `a\|b` into
      // `a\\|b`, which Markdown reads as a literal backslash followed by an
      // unescaped pipe: the row gains a column and the table goes crooked from
      // there down.
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
  );
}

function toMs(value, name) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${name} is not an instant: ${String(value)}`);
  return ms;
}
