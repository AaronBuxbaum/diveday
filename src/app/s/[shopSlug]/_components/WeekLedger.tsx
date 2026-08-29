import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";

/**
 * **The week, at one line per departure** — ADR
 * 20260827-clearwater-surface-language, decision 8.
 *
 * The agenda was already the good grammar (hairline rows on the page
 * background under sticky day rules — one of the two surfaces this ADR
 * generalises from). What it had grown was **six stacked lines per row**: the
 * title, a private-charter marker no public list can ever render, the course
 * session, the shop's free-text description, the price, a labelled dive-site
 * line, a labelled certification line, and a dive-plan line with a
 * two-paragraph aside explaining what a two-tank trip is. Fifteen departures of
 * that is a wall, and every one of those lines is on the trip page one tap
 * below.
 *
 * So a row is **the time, the title, and one meta line** — course session,
 * where it goes, what it asks of you — with the seat state and the price as the
 * row's trailing facts. The rule the tests hold this to: one meta line, and no
 * second detail line ever comes back.
 *
 * Two things the row keeps that look like detail and are not. **"+ 1 more dive
 * site"** rides the site fragment, because a two-tank day showing one site is
 * otherwise a discrepancy rather than a published plan. And **"Above your
 * level"** rides the requirement fragment, because the dimming beside it is
 * colour alone until a word names it (WCAG 1.4.1, issue #696).
 *
 * The labels went with the lines. "Certification · Open Water or higher" reads
 * as a caption on a form; "Open Water or higher" is the fact, and
 * `tripRequirementMarkers` already words each marker so it can stand on its
 * own.
 */

export type WeekLedgerRow = {
  id: string;
  /** The shop-local calendar day, for the day rule above the first row of each day. */
  dayKey: string;
  dayParts: { day: string; weekday: string; month: string };
  /** The trip page. The whole row is a stretched link to it. */
  href: string;
  /** The stretched link's accessible name — date, title and seat state, spoken in full. */
  linkLabel: string;
  timeRange: string;
  title: string;
  /** A course session names its course, and links to it — the row's one nested link. */
  course: { label: string; title: string; href: string } | null;
  /** Where it goes, already joined ("Molasses Reef and French Reef · + 1 more dive site"). */
  site: ReactNode | null;
  /** `tripRequirementMarkers` — each already worded to stand alone. Empty renders nothing. */
  requirements: readonly string[];
  /** The two words that give the dimming a name, or null. */
  aboveLevel: string | null;
  /** Worded seat state ("Full", "Only 2 spots left", "5 spots left"). */
  capacityText: string;
  /** `full` and `low` earn the badge; everything else is a quiet fact (principle 9). */
  capacityTone: "full" | "low" | "quiet";
  /** Already-formatted money, or null for a departure with no price set. */
  price: string | null;
};

export function WeekLedger({
  stickyTop,
  rows,
  listLabel,
}: {
  rows: readonly WeekLedgerRow[];
  listLabel: string;
  /**
   * Where the sticky day rule pins. The full page pins it *below* the chrome
   * bar, by the same token the bar sets its own height from (ADR
   * 20260827-clearwater-surface-language, decision 10) — at `top-0` the bar
   * paints over it and the day never shows once it starts sticking. An embed
   * has no chrome above it, so there the top of the frame is the top of the
   * list.
   */
  stickyTop: string;
}) {
  let lastDayKey: string | null = null;
  return (
    <ul className="flex flex-col" aria-label={listLabel}>
      {rows.map((row) => {
        const newDay = row.dayKey !== lastDayKey;
        lastDayKey = row.dayKey;
        return (
          <Fragment key={row.id}>
            {newDay ? <DayRule parts={row.dayParts} stickyTop={stickyTop} /> : null}
            <Row row={row} />
          </Fragment>
        );
      })}
    </ul>
  );
}

/**
 * The day header as a calendar block — a numeral a reader catches mid-scroll,
 * answering "which day can I go?" faster than a sentence-case date. Sticky, so
 * mid-list the rows under a thumb always belong to a named day.
 *
 * Presentational: every row's own stretched-link label already speaks its full
 * date, so a screen reader loses nothing and the announced item count stays the
 * number of bookable departures.
 */
function DayRule({ parts, stickyTop }: { parts: WeekLedgerRow["dayParts"]; stickyTop: string }) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={`sticky ${stickyTop} z-20 mt-8 flex items-center gap-3 bg-background pt-2 pb-3 first:mt-0`}
    >
      <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
        {parts.day}
      </span>
      <span className="flex flex-col justify-center leading-tight">
        <span className="text-base font-bold tracking-[0.18em] uppercase">{parts.weekday}</span>
        <span className="text-base font-medium tracking-[0.18em] text-muted uppercase">
          {parts.month}
        </span>
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

function Row({ row }: { row: WeekLedgerRow }) {
  const meta: ReactNode[] = [];
  if (row.course) {
    meta.push(
      <span key="course" className="font-medium text-primary">
        {row.course.label} ·{" "}
        <Link
          href={row.course.href}
          className="relative z-10 underline-offset-2 hover:underline focus-visible:underline"
        >
          {row.course.title}
        </Link>
      </span>,
    );
  }
  if (row.site) meta.push(<span key="site">{row.site}</span>);
  for (const marker of row.requirements) meta.push(<span key={`req-${marker}`}>{marker}</span>);
  if (row.aboveLevel) {
    meta.push(
      <span key="above" className="font-medium text-warning-strong">
        {row.aboveLevel}
      </span>,
    );
  }
  // Quiet, never disabled: the row still navigates and every control stays
  // reachable. The quiet is *measured* ink — `text-muted` on the title and
  // time — not a wrapper `opacity-60`, which dimmed every token on the row
  // below its measured contrast (principles.md's tokens section names exactly
  // that pattern; a full boat is still the wait-list candidate somebody wants
  // to read). The Full badge and the "Above your level" word carry the state
  // for everyone; the ink change is only the visual echo.
  const quiet = row.capacityTone === "full" || row.aboveLevel !== null;
  return (
    <li>
      <div className="group relative -mx-3 flex flex-col gap-2 rounded-xl px-3 py-4 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface sm:mx-0 sm:flex-row sm:items-start sm:gap-4 sm:px-4 sm:py-5">
        <Link
          href={row.href}
          className="absolute inset-0 z-0 rounded-xl"
          aria-label={row.linkLabel}
        />
        {/* The date lives on the day rule above, so the row carries only its
            time — `whitespace-nowrap` so a range never breaks at the space
            before AM/PM and strands "PM" on a line of its own. */}
        <div className="shrink-0 sm:w-40">
          <p
            className={`text-base font-semibold tabular-nums whitespace-nowrap${quiet ? " text-muted" : ""}`}
          >
            {row.timeRange}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={`text-base font-semibold group-hover:text-primary${quiet ? " text-muted" : ""}`}
          >
            {row.title}
          </h3>
          {meta.length > 0 ? (
            <p className="mt-1 text-sm text-muted">
              {meta.map((part, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the separator's only identity is its position
                <Fragment key={index}>
                  {index > 0 ? " · " : null}
                  {part}
                </Fragment>
              ))}
            </p>
          ) : null}
        </div>
        {/* The badge is spent on the states that need a decision now — full, or
            nearly — and routine availability reads as the quiet fact it is. The
            chevron is the row's one at-rest tap cue: with no border, a phone row
            (where hover does not exist) read as a text listing rather than as a
            pressable thing. */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Seat state and price are the two facts a diver decides on, so they
              are critical text (principle 2's own definition: a status word, a
              money amount) and hold the 16px floor the rest of the row keeps. */}
          {row.capacityTone === "quiet" ? (
            <p className="text-base text-muted tabular-nums">{row.capacityText}</p>
          ) : (
            <Badge tone={row.capacityTone === "full" ? "neutral" : "warning"} tabularNums>
              {row.capacityText}
            </Badge>
          )}
          {row.price ? <p className="text-base font-semibold tabular-nums">{row.price}</p> : null}
          <DiveDayIcon
            name="chevron-right"
            className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </div>
    </li>
  );
}
