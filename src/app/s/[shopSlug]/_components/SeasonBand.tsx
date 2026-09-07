import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/** One live season, already composed into words by the page. */
export type SeasonBandEntry = {
  id: string;
  /** The shop's own name for the week. Never translated. */
  name: string;
  /** The shop's own sentence about it, or null. */
  note: string | null;
  /** "Through Oct 31" — DiveDay's frame around the shop's dates. */
  through: string;
  /** Present only when the shop named the kind of day this season fills. */
  lens: { href: string; label: string } | null;
};

/**
 * **The reef's calendar, on the shop's own storefront** (issue #1485).
 *
 * Mini-season, the derby, the nesting window a shop plans its summer around —
 * rendered while it is live, to an anonymous visitor, above the schedule,
 * because a week that changes what the diving is like changes which day
 * somebody books.
 *
 * Every word of substance here is the shop's: the name, the sentence, the days.
 * DiveDay supplies the eyebrow, the "Through …" frame around a date and the
 * link out to the narrowed schedule, and nothing else — the same contract a
 * dive site's briefing has (ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words). There is no canned
 * filler for a season with no sentence: it renders its name and its dates and
 * stops.
 *
 * Never inside `?embed=1`. The widget is a window onto the next few
 * departures, and a band would spend a third of a 900px frame on something the
 * host page did not ask for.
 */
export function SeasonBand({
  eyebrow,
  entries,
}: {
  eyebrow: string;
  /** Soonest to end first — the one a visitor still has time to act on. */
  entries: readonly SeasonBandEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    // `max-w-md`, the same column the live-boat panel and the next-boat card
    // hold: three stacked cards at three widths read as three unrelated things.
    <SectionCard className="mt-6 max-w-md">
      <p className={groupLabelClass()}>{eyebrow}</p>
      <ul className="mt-1 space-y-4">
        {entries.map((entry) => (
          <li key={entry.id}>
            <p className={SECTION_TITLE_CLASS}>{entry.name}</p>
            <p className="mt-0.5 text-sm text-muted">{entry.through}</p>
            {entry.note ? <p className="mt-2 text-sm">{entry.note}</p> : null}
            {entry.lens ? (
              <Link
                href={entry.lens.href}
                scroll={false}
                className={buttonClass({ variant: "link", size: "sm", className: "mt-2 px-0" })}
              >
                {entry.lens.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
