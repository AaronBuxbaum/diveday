import type { ReactNode } from "react";
import { DayStrip, type DayStripProps } from "@/components/day/DayStrip";
import { SkyBand } from "@/components/day/SkyBand";
import type { SkyScheme } from "@/lib/sky-scheme";

/**
 * **The top of the day** — ADR 20260919-one-idea, decision I · Tide, slice 23a.
 *
 * The staff home opens with the sky over the shop at the hour it is being read,
 * the date, the day in one line, and the day's own picture. It replaces the
 * greeting and the eyebrow the home carried until now: Tide's floor deletes
 * both, and what stands where they were is the thing they were describing.
 *
 * **Light by day because it is day.** The band follows the sun over the shop
 * rather than the reader's colour scheme, which is H-77's "light mode should
 * render light" answered without a toggle.
 *
 * Every word arrives already worded and zoned. A staff component takes words as
 * props (`staffTranslator` is server-side only), and a rendered time carries
 * the shop's zone or it is four hours wrong on the one screen a crew reads to
 * decide when to leave.
 */

export function DayHeader({
  scheme,
  weekday,
  date,
  summary,
  almanac,
  strip,
  action,
  children,
}: {
  scheme: SkyScheme;
  /** "Thursday" — the day of the week, on its own line above the date. */
  weekday: string;
  /** "August 27" — the date as a name, the largest thing on the page. */
  date: string;
  /** The day in one line: the boats, and what is still waiting. */
  summary: ReactNode;
  /** Sunrise and sunset, or nothing at all where the shop has no coordinates. */
  almanac: string | null;
  /** The day's picture. Omitted on a day with nothing to draw. */
  strip: DayStripProps | null;
  /** The header's one action — the paper day, on a day that has boats. */
  action?: ReactNode;
  /** What the page says under the band: the notices, the next departure, offline. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {/*
       * **Sky to both edges.** The home's `<main>` is `mx-auto max-w-5xl`, so a
       * band that stopped at its content box would be a panel of sky with the
       * page's ground either side of it — which is the one thing the boards do
       * not do. `mx-[calc(50%-50vw)] w-screen` walks the band back out to the
       * viewport from inside that centred column; it is safe here (and only
       * here) because `body { overflow-x: clip }` in `globals.css` contains the
       * scrollbar's width without opening a horizontal scroll container, so the
       * sticky staff nav keeps sticking. `-mt-8 sm:-mt-10` eats `main`'s own
       * top padding, because a sky with a margin above it is a picture of sky.
       *
       * The gutter moves inward with the content, so the band's own inner
       * column carries `max-w-5xl px-4 sm:px-6` — `main`'s exact border box and
       * padding — and the date lines up with the first station under it to the
       * pixel.
       */}
      <SkyBand
        scheme={scheme}
        className="mx-[calc(50%-50vw)] -mt-8 mb-6 w-screen pt-6 pb-5 print:mx-0 print:w-full sm:-mt-10 sm:pt-8"
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--sky-ink-soft)">{weekday}</p>
              <h1 className="font-rounded text-[34px] leading-10 font-bold tracking-tight">
                {date}
              </h1>
              <p className="mt-1 text-[15px] text-(--sky-ink-soft)">{summary}</p>
            </div>
            {action ? <div className="ms-auto shrink-0">{action}</div> : null}
          </div>
          {strip ? <DayStrip {...strip} className="mt-3 h-24 w-full sm:h-28" /> : null}
          {almanac ? <p className="mt-2 text-[13px] text-(--sky-ink-soft)">{almanac}</p> : null}
        </div>
      </SkyBand>
      {children}
    </header>
  );
}
