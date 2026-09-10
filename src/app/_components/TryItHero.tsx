"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { shopInitials } from "@/components/ShopIdentityMenu";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/ledger";
import { GREETING_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverLocale } from "@/i18n/settings";
import { formatTime, formatTimeZoneName } from "@/lib/format";
import {
  type DayLineWindow,
  dayLineHours,
  dayLinePosition,
  dayLineWindow,
  departureMinutes,
  minutesUntilDeparture,
  parseDepartureTime,
  parseTryItName,
  suggestedBrandColor,
  tryItOnboardHref,
  tryItThemeDeclarations,
} from "@/lib/try-it";

/**
 * **Try it with your boats** — the homepage hero that takes three words and
 * redraws as the visitor's own first day (ADR 20260908-one-hand, decision 6,
 * possibility Y; the canvas board `TryItWithYourBoats.dc.html`).
 *
 * A shop owner reading DiveDay's homepage has to imagine their boats on
 * somebody else's screen. This puts theirs on it: their shop's name in the
 * chrome, a colour hashed off that name and run through Harbor's own
 * derivation, their boat on a day line at the time they typed, and the onboard
 * door already filled.
 *
 * **Client state and nothing else.** No fetch, no action, no storage: DiveDay
 * looks nothing up — not their website, not a listing, not a logo — and stores
 * nothing until the door is opened, which is what the hero's own line says.
 * That is why the whole thing is one client component over `src/lib/try-it.ts`,
 * and why the words arrive as props: `staffTranslator` is server-only and a
 * marketing page mounts no `DiverIntlProvider`, so the page reads its own
 * bundle and hands the sentences down (the shape `SuggestShopLink` uses).
 *
 * **The countdown reads the visitor's device.** `src/lib/clock.ts` is the
 * server's clock, frozen at the harness boundary; a browser clock is frozen by
 * `page.clock` instead, which is why a client component under `src/app` is
 * allowed the live one (`scripts/check-clock.mjs` says so in as many words).
 */
export type TryItWords = {
  /** The invitation over the three fields. */
  lede: string;
  shopLabel: string;
  shopPlaceholder: string;
  boatLabel: string;
  boatPlaceholder: string;
  departureLabel: string;
  draw: string;
  /** The line that keeps the drawing honest. */
  drawnFrom: string;
  /** `{shop}` — one per band of the day, the app's own four. */
  greetingMorning: string;
  greetingAfternoon: string;
  greetingEvening: string;
  greetingNight: string;
  /** `{boat}`, `{time}`, `{zone}`. */
  firstDay: string;
  /** `{boat}`, `{minutes}`. */
  leavesInMinutes: string;
  /** `{boat}`, `{hours}`, `{minutes}`. */
  leavesInHours: string;
  boatsRow: string;
  /** `{boat}`. */
  boatsRowMeta: string;
  boatsRowAction: string;
  colorRow: string;
  colorRowMeta: string;
  colorRowAction: string;
  diverRow: string;
  diverRowMeta: string;
  diverRowAction: string;
  /** `{shop}` — the primary door. */
  open: string;
  nothingSaved: string;
  again: string;
};

/**
 * The greeting band the visitor's own clock falls into — the same four bands
 * and the same boundaries the shop home greets a staffer with
 * (`getTimeOfDayGreeting`, `src/lib/today.ts`), read off the device rather than
 * a shop's stored zone because this visitor has no shop yet.
 */
function greetingFor(words: TryItWords, hour: number): string {
  if (hour >= 5 && hour < 12) return words.greetingMorning;
  if (hour >= 12 && hour < 17) return words.greetingAfternoon;
  if (hour >= 17 && hour < 22) return words.greetingEvening;
  return words.greetingNight;
}

/**
 * The bundle's own `{placeholder}` syntax, filled here rather than through ICU:
 * these sentences take a name and a number and never a plural or a date, and
 * the alternative is a `DiverIntlProvider` over a marketing page for four
 * substitutions.
 */
function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  );
}

/** What the visitor typed, once all three fields read as an answer. */
type Drawn = {
  shopName: string;
  boatName: string;
  departure: string;
  /** The device's own zone, or UTC when a runtime cannot name one. */
  timeZone: string;
};

export function TryItHero({
  locale,
  words,
  headline,
  aside,
}: {
  locale: DiverLocale;
  words: TryItWords;
  /** The hero as it stands: eyebrow, title, lede, the two doors, the price line. */
  headline: ReactNode;
  /** The captain's phone beside it. */
  aside: ReactNode;
}) {
  const [shopName, setShopName] = useState("");
  const [boatName, setBoatName] = useState("");
  const [departure, setDeparture] = useState("07:30");
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  if (drawn) {
    return <DrawnHero drawn={drawn} locale={locale} words={words} onAgain={() => setDrawn(null)} />;
  }

  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24">
        <div className="max-w-2xl">
          {headline}
          {/* The three fields sit under the two doors rather than over them:
              the demo still leads (docs/product/marketing.md, "The two doors,
              and which one leads"), and this is a third thing a visitor can do
              rather than the first. */}
          <form
            className="mt-8 rounded-panel border border-border bg-surface p-5 shadow-bed"
            onSubmit={(event) => {
              event.preventDefault();
              const shop = parseTryItName(shopName);
              const boat = parseTryItName(boatName);
              const time = parseDepartureTime(departure);
              // Nothing to say and nothing to draw: the button is disabled
              // until all three read, so this is the belt to that brace.
              if (!shop || !boat || !time) return;
              let timeZone = "UTC";
              try {
                timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
              } catch {
                // A runtime that cannot name its own zone still gets a day
                // line; it is drawn in UTC and the sentence says UTC.
              }
              setDrawn({ shopName: shop, boatName: boat, departure: time, timeZone });
            }}
          >
            <p className="text-sm leading-6 text-muted">{words.lede}</p>
            <FieldGrid columns={1} className="mt-4 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={words.shopLabel}>
                <input
                  name="tryItShop"
                  type="text"
                  autoComplete="organization"
                  value={shopName}
                  onChange={(event) => setShopName(event.target.value)}
                  placeholder={words.shopPlaceholder}
                  className={controlClass}
                />
              </Field>
              <Field label={words.boatLabel}>
                <input
                  name="tryItBoat"
                  type="text"
                  value={boatName}
                  onChange={(event) => setBoatName(event.target.value)}
                  placeholder={words.boatPlaceholder}
                  className={controlClass}
                />
              </Field>
              <Field label={words.departureLabel}>
                <input
                  name="tryItDeparture"
                  type="time"
                  value={departure}
                  onChange={(event) => setDeparture(event.target.value)}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <button
              type="submit"
              disabled={!parseTryItName(shopName) || !parseTryItName(boatName)}
              className={buttonClass({ variant: "secondary", className: "mt-4 w-full sm:w-auto" })}
            >
              {words.draw}
            </button>
          </form>
        </div>
        {aside}
      </div>
    </section>
  );
}

/**
 * The hero as the visitor's first day.
 *
 * The colour arrives as a scoped `<style>` rather than an inline `style`
 * attribute, for the two reasons `tryItThemeDeclarations` states: Tailwind's
 * utilities read a token substituted on `:root`, and an attribute cannot carry
 * a `prefers-color-scheme` block. Every value in the block is a hex the brand
 * derivation produced, so there is nothing in it to escape.
 *
 * It only ever mounts after a click, which is why `new Date()` here needs no
 * hydration guard: the server has never rendered this subtree.
 */
function DrawnHero({
  drawn,
  locale,
  words,
  onAgain,
}: {
  drawn: Drawn;
  locale: DiverLocale;
  words: TryItWords;
  onAgain: () => void;
}) {
  const { shopName, boatName, departure, timeZone } = drawn;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Half a minute: the countdown is spelled in whole minutes, and a shop
    // owner watching "leaves in 59 min" tick down is the whole point of it.
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const color = suggestedBrandColor(shopName);
  const theme = tryItThemeDeclarations(color);
  const css = `[data-try-it-drawn]{${theme.light}}@media(prefers-color-scheme:dark){[data-try-it-drawn]{${theme.dark}}}`;

  const boatMinutes = departureMinutes(departure) ?? 0;
  // `dayWindow`, not `window`: this is a client component and shadowing the
  // global there is a trap for whoever edits it next.
  const dayWindow = dayLineWindow(boatMinutes);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const until = minutesUntilDeparture(boatMinutes, nowMinutes);
  // A time of day has no instant in it, so it renders in UTC off a synthetic
  // date and the sentence beneath names the zone it is read in — the move
  // `formatHourOfDay` documents in `src/lib/format.ts`.
  const departureAt = formatTime(wallTime(boatMinutes), locale, "UTC");
  const zoneName = formatTimeZoneName(locale, timeZone, now);
  const href = tryItOnboardHref({ shopName, boatName, departure, brandColor: color });

  const rows = [
    {
      key: "boats",
      label: words.boatsRow,
      meta: fill(words.boatsRowMeta, { boat: boatName }),
      action: words.boatsRowAction,
    },
    { key: "color", label: words.colorRow, meta: words.colorRowMeta, action: words.colorRowAction },
    { key: "diver", label: words.diverRow, meta: words.diverRowMeta, action: words.diverRowAction },
  ];

  return (
    <section data-try-it-drawn="" className="relative border-b border-border">
      <style>{css}</style>
      {/* The shop's own chrome: its mark and its name. No tabs — a nav that
          goes nowhere is scenery a visitor can click. */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
          >
            {shopInitials(shopName)}
          </span>
          <span className="text-base font-semibold">{shopName}</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-6 py-10 lg:py-16">
        <DayLine
          boatName={boatName}
          departureAt={departureAt}
          locale={locale}
          nowMinutes={nowMinutes}
          window={dayWindow}
          boatMinutes={boatMinutes}
        />

        <p className={`mt-8 ${groupLabelClass("muted")}`}>{words.drawnFrom}</p>
        <h1 className={`mt-3 ${GREETING_TITLE_CLASS}`}>
          {fill(greetingFor(words, now.getHours()), { shop: shopName })}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          {fill(words.firstDay, { boat: boatName, time: departureAt, zone: zoneName })}
        </p>
        <p className="mt-2 text-lg font-medium">
          {until >= 60
            ? fill(words.leavesInHours, {
                boat: boatName,
                hours: Math.floor(until / 60),
                minutes: until % 60,
              })
            : fill(words.leavesInMinutes, { boat: boatName, minutes: until })}
        </p>

        {/* Three rows that are doors, and one door behind all three: the shop
            is not being asked to choose between them, it is being shown what
            the day after this one has in it. */}
        <ul className="mt-8 max-w-2xl">
          {rows.map((row) => (
            <li key={row.key} className="border-b border-border first:border-t">
              <Link
                href={href}
                className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-base hover:bg-primary-tint"
              >
                <span className="font-medium">{row.label}</span>
                <span className="text-sm text-muted">{row.meta}</span>
                <span className="ms-auto text-sm font-medium text-primary">{row.action}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href={href} className={buttonClass({ className: "w-full sm:w-auto" })}>
            {fill(words.open, { shop: shopName })}
          </Link>
          {/* The way back to the three fields. Without it a typo in the shop's
              name is a page reload. */}
          <button
            type="button"
            onClick={onAgain}
            className={buttonClass({ variant: "link", flush: true })}
          >
            {words.again}
          </button>
        </div>
        <p className="mt-3 text-sm text-muted">{words.nothingSaved}</p>
      </div>
    </section>
  );
}

/**
 * The day as a line, the boat as a block on it, and where the visitor's clock
 * has got to — lever F's tide line, drawn for one departure.
 *
 * `aria-hidden`: every fact on it — the boat, the time it leaves, how long
 * until it does — is a sentence in real text directly beneath. A screen reader
 * gets the day; it does not get a picture of the day read out as a list of
 * hours.
 */
function DayLine({
  boatMinutes,
  boatName,
  departureAt,
  locale,
  nowMinutes,
  window: dayWindow,
}: {
  boatMinutes: number;
  boatName: string;
  departureAt: string;
  locale: DiverLocale;
  nowMinutes: number;
  window: DayLineWindow;
}) {
  const boatAt = dayLinePosition(boatMinutes, dayWindow) ?? 0;
  const nowAt = dayLinePosition(nowMinutes, dayWindow);
  return (
    <div
      aria-hidden="true"
      className="relative h-16 rounded-inset bg-gradient-to-b from-primary-tint to-transparent"
    >
      <div className="relative mx-4 h-16">
        <span className="absolute inset-x-0 top-10 h-px bg-border" />
        {dayLineHours(dayWindow).map((hour) => {
          const at = dayLinePosition(hour * 60, dayWindow);
          return at === null ? null : (
            <span
              key={hour}
              className="absolute top-11 -translate-x-1/2 text-[0.625rem] text-border-strong tabular-nums"
              style={{ insetInlineStart: `${at * 100}%` }}
            >
              {formatTime(wallTime(hour * 60), locale, "UTC")}
            </span>
          );
        })}
        {/* Anchored by whichever edge keeps it on the line: a block that
            starts at 85% and carries a long boat name runs off a 390px
            screen, and a day line that clips the one thing on it is worse
            than a block that hangs to the left of its own mark. */}
        <span
          className="absolute top-3 flex h-6 max-w-full items-center overflow-hidden rounded-md border border-primary bg-surface px-2 text-xs font-semibold whitespace-nowrap ring-2 ring-primary-tint"
          style={
            boatAt > 0.6
              ? { insetInlineEnd: `${(1 - boatAt) * 100}%` }
              : { insetInlineStart: `${boatAt * 100}%` }
          }
        >
          {departureAt} {boatName}
        </span>
        {nowAt === null ? null : (
          <span
            className="absolute top-1 h-10 w-0.5 bg-foreground"
            style={{ insetInlineStart: `${nowAt * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A wall-clock minute as an instant a formatter can take. There is no day in
 * it, so every render of it says `timeZone: "UTC"` and the prose says which
 * clock it is read on — the same division `src/lib/calendar-date.ts` makes for
 * a date with no instant.
 */
function wallTime(minutes: number): Date {
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}
