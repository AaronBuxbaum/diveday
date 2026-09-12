import {
  type BrandTheme,
  brandThemeProperties,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
  deriveDarkBrandTheme,
  mixHex,
  parseBrandColor,
} from "./brand";
import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "./calendar-date";

/**
 * **Try it with your boats** — the homepage hero drawn from three words the
 * visitor types (ADR 20260908-one-hand, decision 6, possibility Y).
 *
 * A shop owner reading DiveDay's homepage otherwise has to imagine their boats
 * on somebody else's screen. The hero takes their shop's name, one boat and a
 * first departure, redraws itself as their first day, and hands those three
 * facts to the onboard door. This module is the framework-free half: the
 * colour suggestion, the handoff's query string, and the arithmetic the day
 * line and the countdown read.
 *
 * **Nothing here reaches the network or the database.** DiveDay looks nothing
 * up — no website, no listing, no logo — and stores nothing until the door is
 * opened. Every function below is pure, which is what makes that checkable.
 */

/**
 * The longest shop or boat name the handoff carries. Longer than the 100 the
 * onboard form's own schema allows would be pointless (the door would refuse
 * it); 60 is what fits the hero's chrome at 390px without the name wrapping to
 * a third line. A longer typed name is not truncated — it simply is not carried
 * into the URL, and the visitor retypes it at the door where the real limit is.
 */
export const MAX_TRY_IT_NAME = 60;

/** `HH:MM` on a 24-hour clock — what `<input type="time">` submits. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MINUTES_IN_DAY = 24 * 60;

/**
 * How long the first departure runs. The schedule builder's own blank form
 * opens at 08:30–12:30, so a departure drawn from one typed time inherits that
 * four hours rather than inventing a second answer to the same question
 * (`ScheduleBuilder.tsx`'s `startBlank`).
 */
export const FIRST_DEPARTURE_HOURS = 4;

/**
 * How many seats the first boat gets, since the hero asks for a name and not a
 * number.
 *
 * **Six, deliberately low.** Capacity is not decoration here: it is the ceiling
 * every gate downstream defends, through waivers, cert checks and the manifest,
 * and on a US uninspected vessel six passengers is a legal line
 * (`tripDetailsPatch`'s hull check exists for exactly that). A guessed number
 * that is too high sells seats a shop cannot legally fill; one that is too low
 * costs a shop thirty seconds in the boat register. There is only one safe
 * direction to guess in.
 *
 * **Nothing asks the shop to confirm it, and that is a decision** (owner,
 * 2026-09-10, issue #1632). The shop meets the number where it means
 * something: "6 seats" on its first departure, corrected in the boat register
 * in the thirty seconds named above. Because the guess can only ever be too
 * low, a prompt would buy the shop speed and never safety, which is not
 * enough to earn a step in the one checklist a new shop reads.
 *
 * Revisit once a shop has come through the hero in real use, not before — a
 * surface built ahead of that is the omission turning itself into work. The
 * shape then is First morning's, the same one `shops.units_confirmed_at`
 * already uses for a derived default (issue #712): a `capacity_confirmed_at`
 * column on `boats`, stamped by `updateBoat` when capacity is written, a
 * "Confirm {boat}'s seats" step in `FirstRunChecklist` that clears on the
 * stamp, and `showFirstRunChecklist` — today `totalTrips === 0` — widened or
 * given a second condition, since a hero-drawn shop always arrives with one
 * departure and so never sees the group at all.
 */
export const FIRST_BOAT_CAPACITY = 6;

/**
 * A visitor's typed name, as it is carried and drawn: the inner runs of
 * whitespace collapsed, the ends trimmed, and control characters refused
 * outright. Returns null for anything that is not a name a shop would sign.
 */
export function parseTryItName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Control characters, including the newline a paste can carry: a name is one
  // line. `\p{C}` also covers the invisible formatting characters that make two
  // different strings paint identically.
  if (/\p{C}/u.test(input)) return null;
  const name = input.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_TRY_IT_NAME) return null;
  return name;
}

/** `HH:MM`, or null. Anything else — a bare hour, "7:30 AM", "25:00" — is junk. */
export function parseDepartureTime(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return TIME_PATTERN.test(input.trim()) ? input.trim() : null;
}

/** Minutes since local midnight for an `HH:MM` already parsed. */
export function departureMinutes(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * How long until the boat leaves, in minutes, read off a wall clock rather than
 * an instant: both arguments are minutes since local midnight, so the caller
 * decides whose midnight it is. The hero's is the visitor's own device.
 *
 * A time already past today counts to the same time tomorrow, which is the
 * departure the door will actually create (`firstDepartureDay`). The wrap is
 * why this is arithmetic on minutes and not a subtraction of two `Date`s: a
 * countdown that goes negative reads as a boat that left without them.
 */
export function minutesUntilDeparture(departure: number, now: number): number {
  const delta = departure - now;
  return delta >= 0 ? delta : delta + MINUTES_IN_DAY;
}

/**
 * The day the first departure lands on: **tomorrow in the shop's own zone**,
 * never today. A shop that signs up at 9 AM has already missed a 7:30 boat, and
 * a departure in the past on the first Today is a worse welcome than no
 * departure at all.
 */
export function firstDepartureDay(now: Date, timeZone: string): CalendarDate {
  return shiftCalendarDate(calendarDateInTimezone(now, timeZone), 1);
}

/**
 * The end of that first departure — the start plus {@link FIRST_DEPARTURE_HOURS},
 * held inside the same calendar day.
 *
 * The clamp is not cosmetic: `tripDetailsPatch` parses a departure's start and
 * end against **one** date, so a 9 PM start with a four-hour run would produce
 * an end before its start and the departure would simply not be created. A late
 * boat gets a short day on the board instead of no boat at all, and the shop
 * moves it in the builder.
 *
 * **And at the very end of the day there is no room left to clamp into.** A
 * 23:59 departure clamps to an end equal to its own start, which
 * `tripDetailsPatch` refuses as `end_before_start` — so this says no here
 * instead, and `createFirstDay` writes neither the departure nor the boat. A
 * shop that types 23:59 into the hero gets a clean sign-up and an empty
 * register rather than a hull with a departure that never existed.
 */
export function firstDepartureEndTime(start: string): string | null {
  const minutes = departureMinutes(start);
  if (minutes === null) return null;
  const end = Math.min(minutes + FIRST_DEPARTURE_HOURS * 60, MINUTES_IN_DAY - 1);
  if (end <= minutes) return null;
  const hour = Math.floor(end / 60);
  return `${String(hour).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/**
 * The stretch of the day the hero's line draws, as minutes since midnight.
 *
 * Sixteen hours from 5 AM is the working day the canvas draws (ticks at 5, 8,
 * 11, 2, 5, 8), and it holds every departure a dive shop actually runs. A boat
 * outside it — a 4 AM liveaboard run, a 10 PM night dive — slides the window
 * rather than falling off the end of it, so the line never draws a day with no
 * boat on it.
 */
export const DAY_LINE_SPAN = 16 * 60;

export type DayLineWindow = { start: number; span: number };

export function dayLineWindow(departure: number): DayLineWindow {
  const span = DAY_LINE_SPAN;
  // An hour of air on whichever side the boat is crowding, so the block is
  // never painted flush against an end of the track.
  const noLaterThan = departure - 60;
  const noEarlierThan = departure + 60 - span;
  const preferred = Math.min(Math.max(5 * 60, noEarlierThan), noLaterThan);
  // And the window stays inside the day it is drawing.
  const start = Math.min(Math.max(0, preferred), MINUTES_IN_DAY - span);
  return { start, span };
}

/**
 * Where a minute sits on that line, 0 to 1 — or null when it is off the end,
 * which is what the "now" marker does at 3 AM on a 7:30 boat. A marker that
 * clamps to the edge instead would say the day has already started.
 */
export function dayLinePosition(minute: number, window: DayLineWindow): number | null {
  const fraction = (minute - window.start) / window.span;
  return fraction < 0 || fraction > 1 ? null : fraction;
}

/** The hour marks on that line, every three hours inside the window. */
export function dayLineHours(window: DayLineWindow): number[] {
  const hours: number[] = [];
  const first = Math.ceil(window.start / 180) * 3;
  for (let hour = first; hour * 60 <= window.start + window.span; hour += 3) hours.push(hour);
  return hours;
}

/**
 * A 32-bit FNV-1a over the name, case- and space-insensitive, so "Coral Cove
 * Dive Co." and "coral  cove dive co." are the same shop and get the same
 * colour on every device and every render. Never a random hue: the hero says
 * the colour came from what they typed, and a colour that moved on reload would
 * make that a lie.
 */
function hashName(name: string): number {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** One hue at a fixed saturation and lightness, as `#rrggbb`. */
function hueToHex(hue: number): string {
  // The two constants are the whole palette: enough saturation that a shop
  // recognizes the colour as theirs, dark enough that most hues already read as
  // text on the sand ground before the derivation moves them.
  const saturation = 0.62;
  const lightness = 0.34;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [r, g, b] = (
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary]
  ).map((channel) => Math.round((channel + base) * 255));
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The colour the hero suggests for a shop, from its name alone.
 *
 * A hue is hashed off the name and then handed to **Harbor's own derivation**
 * (`deriveBrandTheme`, ADR 20260901-diveday-reimagined, decision 2), which is
 * the only thing in this codebase that decides whether a brand colour reads:
 * it darkens in 8% steps until the colour clears 4.5:1 on the storefront's
 * ground and on its own tint. Suggesting a colour with a second, softer rule
 * would put a shop on a storefront whose links fail contrast the day they open
 * it, so there is no second rule here — this function picks a hue and Harbor
 * decides what shade of it is legible.
 *
 * A name with nothing in it gets DiveDay's own lagoon, which is what the
 * storefront wears when a shop has set no colour at all.
 */
export function suggestedBrandColor(name: string): string {
  const parsed = parseTryItName(name);
  if (!parsed) return DIVEDAY_BRAND_COLOR;
  return deriveBrandTheme(hueToHex(hashName(parsed) % 360)).primary;
}

/**
 * The suggested colour as the tokens every primitive already reads, for a
 * `<style>` block scoped to the drawn hero rather than the document.
 *
 * **Both halves of each pair.** `--primary` is what `globals.css` and a raw
 * `var()` read; `--color-primary` is what Tailwind's own utilities read, and
 * its value (`var(--primary)`) was substituted where it is *declared*, on
 * `:root` — so re-pointing `--primary` alone further down the tree changes
 * nothing at all. `--primary-sunken` is derived here for the same reason: at
 * `:root` it is a `color-mix` of the root's primary, and it is what a pressed
 * primary button wears.
 *
 * Two schemes, like `BrandStyle`: an inline `style` attribute cannot carry a
 * `prefers-color-scheme` block, and a single block would dress the hero in its
 * light colour at depth (issue #1265).
 *
 * **The input is checked here, not trusted from the caller.** This is the one
 * function in the slice whose output is rendered as *stylesheet text* rather
 * than as a React text node, so a caller that ever handed it a string off a
 * request would be handing it a way out of the block. Today's only caller
 * passes `suggestedBrandColor`, which cannot return anything but a derived
 * hex — this makes that a property of the function instead of a property of
 * the call site. Anything `parseBrandColor` will not take becomes DiveDay's
 * own lagoon, which is what a shop with no colour wears anyway.
 */
export function tryItThemeDeclarations(color: string): { light: string; dark: string } {
  const checked = parseBrandColor(color);
  const safe = checked.valid && checked.value ? checked.value : DIVEDAY_BRAND_COLOR;
  const declarations = (theme: BrandTheme) =>
    Object.entries({
      ...brandThemeProperties(theme),
      "--primary-sunken": mixHex(theme.primary, "#000000", 0.35),
    })
      .flatMap(([name, value]) =>
        name.startsWith("--primary")
          ? [`${name}:${value}`, `--color${name.slice(1)}:${value}`]
          : [`${name}:${value}`],
      )
      .join(";");
  return {
    light: declarations(deriveBrandTheme(safe)),
    dark: declarations(deriveDarkBrandTheme(safe)),
  };
}

/**
 * What the hero typed, as the onboard door reads it back. Every field is
 * independent: a visitor who hand-edits one parameter into junk loses that
 * field and keeps the rest, because the door's job is to be filled in, not to
 * refuse a link.
 */
export type TryItHandoff = {
  shopName: string | null;
  boatName: string | null;
  departure: string | null;
  brandColor: string | null;
};

/**
 * The query parameters the hero writes and the door reads — and the form
 * fields the door posts, which is why every one of them is `unknown`: a
 * `searchParams` value is `string | string[]`, a `FormData` value is a string
 * or a `File`, and the parsers below are the one place either shape is judged.
 */
export type TryItParams = {
  shop?: unknown;
  boat?: unknown;
  departure?: unknown;
  color?: unknown;
};

function one(value: unknown): string | undefined {
  // A repeated parameter (`?shop=a&shop=b`) is a hand-edited URL and an
  // uploaded file is not a shop name; take neither rather than guess.
  return typeof value === "string" ? value : undefined;
}

export function parseTryItHandoff(params: TryItParams): TryItHandoff {
  const color = parseBrandColor(one(params.color));
  return {
    shopName: parseTryItName(one(params.shop)),
    boatName: parseTryItName(one(params.boat)),
    departure: parseDepartureTime(one(params.departure)),
    brandColor: color.valid ? color.value : null,
  };
}

/**
 * The hero's primary door: the onboard form with the three fields already
 * filled and the suggested colour riding along. The funnel tag stays first so
 * the URL reads the way every other trial link on the site reads.
 *
 * Only fields that survived parsing are carried, so a half-filled hero produces
 * a half-filled door rather than a URL with `undefined` in it.
 */
export function tryItOnboardHref(handoff: {
  shopName?: string | null;
  boatName?: string | null;
  departure?: string | null;
  brandColor?: string | null;
}): string {
  const params = new URLSearchParams({ from: "home-drawn" });
  const shopName = parseTryItName(handoff.shopName);
  const boatName = parseTryItName(handoff.boatName);
  const departure = parseDepartureTime(handoff.departure);
  const color = parseBrandColor(handoff.brandColor);
  if (shopName) params.set("shop", shopName);
  if (boatName) params.set("boat", boatName);
  if (departure) params.set("departure", departure);
  if (color.valid && color.value) params.set("color", color.value);
  return `/onboard?${params.toString()}`;
}
