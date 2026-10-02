import { Fragment, type ReactNode } from "react";

/**
 * **The departure is an hour** — ADR 20260919-one-idea, decision I · Tide,
 * slice 23c: the time the boat leaves as the page's one name, the boat and its
 * crew under it.
 *
 * **The hour is the name, not the title.** A crew standing on a dock at 6:58
 * is not looking for "Two-Tank Reef — Molasses & French"; they know which trip
 * it is. What they need first is *7:00*. So the time takes the display size
 * the date takes on the home, and the title reads under it.
 *
 * **Everything on it is said again below.** The count, the crew, the blockers
 * and the roster are all in the body. It gates nothing.
 *
 * Words arrive already worded and zoned. A staff component takes words as
 * props (`staffTranslator` is server-side only), and a rendered time carries
 * the shop's zone or it is hours wrong on the one screen a crew reads to
 * decide when to leave.
 */

/**
 * The dot between two facts, glued to the fact before it by a no-break space.
 * It rides *inside* that fact's box: a line may break on either side of an
 * atomic inline box whatever character stands beside it, so a dot outside the
 * box could start a line.
 */
const FACT_SEPARATOR = " ·";

/** The line of facts' type, whose line box (15px at the inherited 1.5) the skeleton's bars take. */
const FACTS_LINE_CLASS = "mt-1 text-[15px]";

export function VoyageHeader({
  back,
  hour,
  title,
  facts,
  action,
  badge,
}: {
  /** The way back to the day this departure belongs to. */
  back: ReactNode;
  /** "7:00 AM" — when the boat leaves, and the largest thing on the page. */
  hour: string;
  /** The departure's own name, under its hour. */
  title: string;
  /**
   * The boat, each crew member, how full it is, the day and the price — each
   * fact already worded, read as one line and set so it breaks only between
   * two of them.
   */
  facts: readonly string[];
  /** The header's one action. */
  action?: ReactNode;
  /**
   * A cancelled departure's badge, beside the hour, because a blow-out is the
   * first thing a crew must read.
   */
  badge?: ReactNode;
}) {
  return (
    <header>
      <div className="flex items-center gap-3">
        {back}
        {/* The slot lays its children out itself: the page hands over two
            controls in a fragment, and two inline boxes from a fragment touch,
            so one painted over the other's focus ring. `gap-2` is more than
            the ring's 5px. */}
        {action ? <div className="ms-auto flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-rounded text-[34px] leading-10 font-bold tracking-tight tabular-nums">
          {hour}
        </p>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </div>
      <h1 className="mt-1 text-[19px] leading-6 font-semibold text-balance">{title}</h1>
      {/*
       * **A line breaks between facts, never inside one** (pixel-craft class
       * 8). One string joined with " · " broke at any space: "· Tue," /
       * "Jul 21", "9 of 12 seats" / "taken" at 390. Each fact is an
       * `inline-block`, an atomic box, so a line ends only between two, and
       * one longer than the whole line still wraps inside its own box. Not
       * `whitespace-nowrap`: a boat or a crew name is free text a shop typed,
       * and glued whole it could run off a phone (the reason `joinFacts`
       * leaves ordinary words breakable).
       */}
      <p className={`${FACTS_LINE_CLASS} text-muted`}>
        {facts.map((fact, index) => {
          const last = index === facts.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: two crew members may share a name, and the facts never reorder
            <Fragment key={index}>
              <span className="inline-block">
                {fact}
                {last ? null : FACT_SEPARATOR}
              </span>
              {last ? null : " "}
            </Fragment>
          );
        })}
      </p>
    </header>
  );
}

/**
 * **The header as a navigation paints it**, for the departure's `loading.tsx`:
 * one bar per line of the header, each its line's own height.
 *
 * - `h-11`, the back row: the header's controls are 44px.
 * - `h-10`, the hour's `leading-10`; `h-6`, the title's `leading-6`, on one
 *   line, as a title is at 390.
 * - The facts at their own type, one `h-lh` box per line: two on a phone,
 *   where the seeded line wraps ("… 9 of 12 seats" / "taken · Tue, Jul 21 …"),
 *   one from `sm`.
 */
export function VoyageHeaderSkeleton() {
  const bar = "rounded bg-surface-sunken";
  return (
    <header>
      <div className="flex h-11 items-center gap-3">
        <div className={`h-4 w-20 ${bar}`} />
        <div className={`ms-auto h-4 w-24 ${bar}`} />
      </div>
      <div className={`mt-3 h-10 w-36 ${bar}`} />
      <div className={`mt-1 h-6 w-72 max-w-full ${bar}`} />
      <div className={FACTS_LINE_CLASS}>
        <div className={`h-lh w-80 max-w-full ${bar}`} />
        <div className="h-lh pt-1 sm:hidden">
          <div className={`h-full w-48 ${bar}`} />
        </div>
      </div>
    </header>
  );
}
