import type { ReactNode } from "react";
import { DayStrip, type DayStripProps } from "@/components/day/DayStrip";
import { SkyBand } from "@/components/day/SkyBand";
import type { SkyScheme } from "@/lib/sky-scheme";

/**
 * **The departure is an hour** — ADR 20260919-one-idea, decision I · Tide,
 * slice 23c. The canvas draws this page as the 7:00 departure read at 6:58:
 * the sky over the shop at that hour, the time the boat leaves as the page's
 * one name, the boat and its crew under it, and the day strip zoomed from the
 * whole day down to this one voyage.
 *
 * **The hour is the name, not the title.** A crew standing on a dock at 6:58
 * is not looking for "Two-Tank Reef — Molasses & French"; they know which trip
 * it is. What they need first is *7:00*, and how long until it. So the time
 * takes the display size the date takes on the home, and the title reads under
 * it — the same move, one zoom in.
 *
 * **Everything on it is said again below.** The count, the crew, the blockers
 * and the roster are all in the body; this is the picture of them, exactly as
 * `DayHeader` is the picture of the day's stations. Take the band away and the
 * page still says everything it said.
 *
 * **It gates nothing**, like every other sky in the product: no readiness,
 * admission or capacity rule reads a scheme or a coordinate from the strip.
 *
 * Words arrive already worded and zoned. A staff component takes words as
 * props (`staffTranslator` is server-side only), and a rendered time carries
 * the shop's zone or it is hours wrong on the one screen a crew reads to
 * decide when to leave.
 */

export function VoyageHeader({
  scheme,
  back,
  hour,
  title,
  line,
  strip,
  action,
  badge,
  subNav,
}: {
  scheme: SkyScheme;
  /** The way back to the day this departure belongs to. */
  back: ReactNode;
  /** "7:00 AM" — when the boat leaves, and the largest thing on the page. */
  hour: string;
  /** The departure's own name, under its hour. */
  title: string;
  /** The boat, its crew and how full it is, in one line. */
  line: string;
  /** The voyage drawn: lines off, the dives, the way back. Null with nothing to draw. */
  strip: DayStripProps | null;
  /** The band's one action. */
  action?: ReactNode;
  /**
   * A cancelled departure's badge. It rides the sky rather than the body
   * because a blow-out is the first thing a crew must read, and the words
   * under the band are further down the page than a decision to drive to the
   * dock is made.
   */
  badge?: ReactNode;
  /** Trip / Manifest / Prep, below the band. */
  subNav?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {/*
       * Sky to both edges, exactly as `DayHeader` does it and for the same
       * reason: the trip shell is `mx-auto max-w-5xl`, so a band stopping at
       * its content box would be a panel of sky with the page's ground either
       * side of it. `mx-[calc(50%-50vw)] w-screen` walks it back out to the
       * viewport from inside that centred column, which is safe because
       * `body { overflow-x: clip }` contains the scrollbar without opening a
       * horizontal scroll container. `-mt-8 sm:-mt-10` eats the shell's own
       * top padding, because a sky with a margin above it is a picture of sky.
       */}
      <SkyBand
        scheme={scheme}
        className="mx-[calc(50%-50vw)] -mt-8 mb-5 w-screen pt-5 pb-5 print:mx-0 print:w-full sm:-mt-10 sm:pt-7"
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {back}
            {action ? <div className="ms-auto shrink-0">{action}</div> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-rounded text-[34px] leading-10 font-bold tracking-tight tabular-nums">
              {hour}
            </p>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
          <h1 className="mt-1 text-[19px] leading-6 font-semibold text-balance">{title}</h1>
          <p className="mt-1 text-[15px] text-(--sky-ink-soft)">{line}</p>
          {strip ? <DayStrip {...strip} className="mt-3 h-24 w-full sm:h-28" /> : null}
        </div>
      </SkyBand>
      {subNav}
    </header>
  );
}
