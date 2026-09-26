import Link from "next/link";
import { type CSSProperties, Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DoorChevron } from "@/components/ui/ledger";
import { FIGURE_LARGE_CLASS } from "@/components/ui/typography";

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
  /**
   * The shop's own word for this kind of day, leading the meta line (ADR
   * 20260904-reef-all-the-way-down, decision 2).
   *
   * Null is the ordinary case and pushes **nothing** — no fragment, no
   * separator, and never "Uncategorised". It is deliberately plain ink with no
   * tint, badge or tone: beside a certification marker on the same line, a
   * coloured "First time back in a while" reads as an eligibility rule rather
   * than as the shop's description of its own day (the trap #1162's triage
   * names).
   */
  lens: string | null;
  /** A course session names its course, and links to it — the row's one nested link. */
  course: { label: string; title: string; href: string } | null;
  /** Where it goes, already joined ("Molasses Reef and French Reef · + 1 more dive site"). */
  site: ReactNode | null;
  /** `tripRequirementMarkers` — each already worded to stand alone. Empty renders nothing. */
  requirements: readonly string[];
  /** The two words that give the dimming a name, or null. */
  aboveLevel: string | null;
  /**
   * **Why a departure that demands a level is open to *this* reader** — the
   * sentence a diver whose phone carries their shelf gets instead of a warn
   * (slice 20t): "Your Advanced card clears this".
   *
   * Only ever set from a verified shelf capability, so an anonymous list can
   * never carry it — the row would otherwise be telling whoever picked up the
   * phone what card its owner holds. Plain ink, not a pill: it is the reason a
   * row is *ordinary*, and a coloured capsule would make an absence of trouble
   * look like a state.
   */
  clears: string | null;
  /** Worded seat state ("Full", "Only 2 spots left", "5 spots left"). */
  capacityText: string;
  /** `full` and `low` earn the badge; everything else is a quiet fact (principle 9). */
  capacityTone: "full" | "low" | "quiet";
  /** Already-formatted money, or null for a departure with no price set. */
  price: string | null;
};

/**
 * **The price's column is as wide as the list's longest price** (pixel-craft
 * class 3), so every row's seat state and chevron end on one x in whatever
 * currency the shop sells in. A fixed width held a four-figure dollar or euro
 * price and nothing longer: "$145.50" (a price with cents keeps them) runs to
 * about 6.25ch, and a rupiah, yen or Egyptian pound shop's ordinary prices
 * ("Rp 1.500.000", "¥15,000", "EGP 2,500") run far past it, so each such row's
 * price set its own column again.
 *
 * A character a `ch`: the price is set in tabular figures, where a digit is
 * exactly 1ch, and its separators are narrower. Half a digit more covers a
 * currency sign a little wider than a digit (€ is about 1.1ch) in a price with
 * no separator to give the difference back ("€95"). The width is a custom
 * property on the list, so `ch` resolves in the price's own face, and each
 * row's column reads it from `sm` up. Null when no row has a price: a list with
 * nothing to charge draws no column at all.
 */
function priceColumnWidth(rows: readonly WeekLedgerRow[]): string | null {
  const longest = Math.max(0, ...rows.map((row) => (row.price ? [...row.price].length : 0)));
  return longest > 0 ? `${longest + 0.5}ch` : null;
}

type PriceColumnStyle = CSSProperties & { "--price-col": string };

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
  const priceColumn = priceColumnWidth(rows);
  const style: PriceColumnStyle | undefined = priceColumn
    ? { "--price-col": priceColumn }
    : undefined;
  return (
    // `-mb-4 sm:-mb-5` hands back the last row's lower room — its `py-4
    // sm:py-5`, kept for the hover fill and unpainted at rest — so whatever
    // follows measures from the last row's words. Stacked on the next
    // section's margin, it put "Courses" 78px under the last meta line at
    // 1280 against the page's 56px section gap.
    <ul className="-mb-4 flex flex-col sm:-mb-5" aria-label={listLabel} style={style}>
      {rows.map((row) => {
        const newDay = row.dayKey !== lastDayKey;
        lastDayKey = row.dayKey;
        return (
          <Fragment key={row.id}>
            {newDay ? <DayRule parts={row.dayParts} stickyTop={stickyTop} /> : null}
            <Row row={row} priceColumn={priceColumn !== null} />
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
 *
 * **Each part stands in a fixed column**, so every rule's hairline starts at one
 * x (pixel-craft class 3). Shrink-wrapped, the hairline started 15px past each
 * weekday's own ink — nine rules 9px apart at 1280 — and a one-digit day would
 * have pulled its weekday and hairline 19px further left. The numeral's box is
 * two tabular digits (`2ch`); the weekday column holds the longest label either
 * locale prints, es-ES "SEPT" (about 51px with its tracking; en-US "MON" is 46).
 * `loading.tsx` draws its rule on the same columns.
 */
function DayRule({ parts, stickyTop }: { parts: WeekLedgerRow["dayParts"]; stickyTop: string }) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={`sticky ${stickyTop} z-20 mt-8 flex items-center gap-3 bg-background pt-2 pb-3 first:mt-0`}
    >
      <span className={`${FIGURE_LARGE_CLASS} min-w-[2ch] leading-none`}>{parts.day}</span>
      <span className="flex min-w-14 flex-col justify-center leading-tight">
        <span className="text-base font-bold tracking-[0.18em] uppercase">{parts.weekday}</span>
        <span className="text-base font-medium tracking-[0.18em] text-muted uppercase">
          {parts.month}
        </span>
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/**
 * **A fact on the meta line is one box** (pixel-craft class 8), so the line
 * breaks at a " · " between facts and a fact moves to the next line whole. As
 * plain inline text it broke at any space: on a phone "Advanced Open / Water or
 * higher" and "Scuba / Refresher" split five times on the schedule at 390.
 * Only a fact longer than the whole line wraps inside itself — never
 * `whitespace-nowrap`, which would run a long site name past the column.
 */
const FACT = "inline-block";

function Row({ row, priceColumn }: { row: WeekLedgerRow; priceColumn: boolean }) {
  const meta: ReactNode[] = [];
  // The shop's own word leads the line, before the course and the site: it is
  // what the reader is scanning for once they have tapped a lens, and it is the
  // one fragment on the row written by the shop rather than by DiveDay.
  if (row.lens)
    meta.push(
      <span key="lens" className={FACT}>
        {row.lens}
      </span>,
    );
  if (row.course) {
    // The course's name is a box of its own inside the fact, so a fact too long
    // for the line breaks after "Course session ·" rather than inside the name.
    meta.push(
      <span key="course" className={`${FACT} font-medium text-primary`}>
        {row.course.label} ·{" "}
        <Link
          href={row.course.href}
          className={`${FACT} relative z-10 underline-offset-2 hover:underline focus-visible:underline`}
        >
          {row.course.title}
        </Link>
      </span>,
    );
  }
  if (row.site)
    meta.push(
      <span key="site" className={FACT}>
        {row.site}
      </span>,
    );
  for (const marker of row.requirements)
    meta.push(
      <span key={`req-${marker}`} className={FACT}>
        {marker}
      </span>,
    );
  if (row.aboveLevel) {
    meta.push(
      <span key="above" className={`${FACT} font-medium text-warning-strong`}>
        {row.aboveLevel}
      </span>,
    );
  }
  if (row.clears)
    meta.push(
      <span key="clears" className={FACT}>
        {row.clears}
      </span>,
    );
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
      {/* `sm:items-baseline`: the seat group centres a 28px badge, taller than
          the title's 24px line, so top-aligned its price and chevron sat 2–3px
          below the title. On one baseline — the badge's word's — they share
          its line. The fill answers the row's own door (`>a`, the overlay
          link, a direct child), not the course link nested in its meta line,
          which lit the whole row as if the row had focus. */}
      <div className="group relative -mx-3 flex flex-col gap-2 rounded-lg px-3 py-4 transition-colors hover:bg-surface has-[>a:focus-visible]:bg-surface sm:mx-0 sm:flex-row sm:items-baseline sm:gap-4 sm:px-4 sm:py-5">
        {/* The ring is drawn inside the row: below `sm` the row bleeds
            `-mx-3` into a 16px gutter, 4px from the screen's edge, which cut
            the outset ring by a pixel on each side. `scroll-mt-16` keeps a
            focused row clear of the day rule pinned over the list (60px, and
            4px): the page's scroll inset clears only the chrome above it, so a
            row focused 56–116px down stayed under its own rule. */}
        <Link
          href={row.href}
          className="absolute inset-0 z-0 rounded-inset scroll-mt-16 focus-visible:focus-ring-inset"
          aria-label={row.linkLabel}
        />
        {/* The date lives on the day rule above, so the row carries only its
            time — `whitespace-nowrap` so a range never breaks at the space
            before AM/PM and strands "PM" on a line of its own. 176px holds
            the longest range, eight digits ("10:00 AM – 12:30 PM", about
            166px); the seed's seven-digit ones sized it at 160, which an
            eight-digit range overran by 7px toward the title. */}
        <div className="shrink-0 sm:w-44">
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
            pressable thing. Below `sm` the row is a column and this group is
            stretched to its width, so the chevron takes `ms-auto` to hold the
            row's end rather than trailing each row's words. It is the doors'
            glyph (`DoorChevron`), its box cropped to its ink, so the arrow
            ends on the row's edge — the day rule's hairline's — rather than
            5px inside it. */}
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
          {/* The price's column stands on every row of a list that charges
              anything, so a departure with no price keeps its seat state and
              chevron where the others' are rather than sliding 43px into the
              price's place. It is as wide as the list's longest price
              (`--price-col`, `priceColumnWidth`) and set to its end, so seat
              states end on one x too. Below `sm` the group packs from the
              start and the chevron holds the row's end by itself, so an empty
              column there is only a gap and stands down. */}
          {priceColumn ? (
            <p
              className={`text-base font-semibold tabular-nums sm:min-w-(--price-col) sm:text-end${row.price ? "" : " max-sm:hidden"}`}
            >
              {row.price}
            </p>
          ) : null}
          <DoorChevron className="ms-auto transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </li>
  );
}
