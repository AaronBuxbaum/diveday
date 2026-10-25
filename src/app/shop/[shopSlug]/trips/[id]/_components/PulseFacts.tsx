import Link from "next/link";
import { RowGlyph } from "@/app/shop/[shopSlug]/_components/today/row-glyph";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { TripPulseFact } from "./TripPulse";

const FACT_LINK_CLASS =
  "-my-3 inline-flex min-h-11 items-center text-sm font-medium hover:underline";

const FACT_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  work: "text-primary",
} as const;

function FactLink({ fact }: { fact: TripPulseFact }) {
  return (
    <Link href={fact.href} className={`${FACT_LINK_CLASS} ${FACT_INK[fact.tone ?? "work"]}`}>
      {fact.text}
    </Link>
  );
}

/**
 * The facts above the Divers tab's head count: one summary line, never a
 * stack of links that pull the eye before the count does (UX audit
 * 2026-10-07, item 23).
 *
 * A fact that holds the boat up (`tone: "danger"`) always stands on its own
 * line: a missing instructor or a boat clash is never one tap deep. A warning
 * (nitrox asked for with no verified card, issue #2549) also stands on its own
 * line, in warning ink, below the hazards. The rest
 * (rental sizes to take, orders awaiting payment) are work, not hazards: one
 * of them renders as its own link, and two or more fold into one line,
 * "Needs you · 7", that opens to the same links: Today's own rows for this
 * boat when it is in Today's window, so the two numbers are one. Not "before boarding": an
 * order awaiting payment does not gate boarding.
 *
 * **The stack's gap is measured to the words** (K-262). Each fact is a 44px
 * link round a 20px line, and gives the unseen 12px back as `-my-3`, so the
 * row is its words' height and the targets overhang the gaps; `gap-y-7` keeps
 * a wrapped line's box 4px clear of the one above.
 */
export function PulseFacts({
  facts,
  foldLabel,
  kindCount = (kind, count) => `${kind} · ${count}`,
  rosterHref = "#roster",
}: {
  facts: readonly TripPulseFact[];
  /** "Needs you · 2", already counted for the folded facts. */
  foldLabel: (count: number) => string;
  /** A chip that stands for several facts of one kind: "Contact · 3". */
  kindCount?: (kind: string, count: number) => string;
  /** Where a chip whose facts open different doors lands: the roster, every diver's row. */
  rosterHref?: string;
}) {
  if (facts.length === 0) return null;
  const hazards = facts.filter((fact) => fact.tone === "danger");
  const warnings = facts.filter((fact) => fact.tone === "warning");
  const work = facts.filter((fact) => fact.tone === undefined);
  const fold = work.length > 1;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-7">
      {hazards.map((fact) => (
        <FactLink key={fact.key ?? fact.href} fact={fact} />
      ))}
      {warnings.map((fact) => (
        <FactLink key={fact.href} fact={fact} />
      ))}
      {fold ? (
        <details className="group/facts w-full">
          <summary
            className={`${FACT_LINK_CLASS} cursor-pointer list-none gap-2 text-primary select-none [&::-webkit-details-marker]:hidden`}
          >
            <DisclosureCaret className="group-open/facts:rotate-90" />
            {foldLabel(work.length)}
          </summary>
          <ul className="mt-4 flex flex-wrap gap-2">
            {pulseChips(work, rosterHref).map((chip) => (
              <li key={chip.key}>
                <Link
                  href={chip.href}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-sunken hover:no-underline"
                >
                  {chip.tone ? <RowGlyph tone={chip.tone} icon={chip.icon} /> : null}
                  {chip.facts.length > 1 && chip.kind !== undefined ? (
                    <span className="font-medium tabular-nums">
                      {kindCount(chip.kind, chip.facts.length)}
                    </span>
                  ) : (
                    <span>{chip.facts[0]?.text}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        work.map((fact) => <FactLink key={fact.key ?? fact.href} fact={fact} />)
      )}
    </div>
  );
}

type PulseChip = {
  key: string;
  href: string;
  kind?: string;
  icon?: NonNullable<TripPulseFact["chip"]>["icon"];
  tone?: NonNullable<TripPulseFact["chip"]>["tone"];
  facts: TripPulseFact[];
};

/**
 * **The opened "Needs you · 9" is a count strip** (visual review 2026-10-24,
 * A46): one chip per kind, drawn as Today draws that kind's row (its glyph,
 * its word, its count), in the order the kinds first appear. A kind of one
 * fact keeps that fact's own words; several become "Contact · 3". Nothing a
 * fact linked to is lost: a chip whose facts share a door opens it, and one
 * whose facts open different doors (three divers' records) opens the roster,
 * where every one of those divers has their row and its flag.
 */
export function pulseChips(work: readonly TripPulseFact[], rosterHref: string): PulseChip[] {
  const chips: PulseChip[] = [];
  const byKind = new Map<string, PulseChip>();
  for (const fact of work) {
    const kind = fact.chip?.kind;
    const existing = kind === undefined ? undefined : byKind.get(kind);
    if (existing) {
      existing.facts.push(fact);
      if (existing.href !== fact.href) existing.href = rosterHref;
      continue;
    }
    const chip: PulseChip = {
      key: kind ?? fact.key ?? fact.href,
      href: fact.href,
      kind,
      icon: fact.chip?.icon,
      tone: fact.chip?.tone,
      facts: [fact],
    };
    chips.push(chip);
    if (kind !== undefined) byKind.set(kind, chip);
  }
  return chips;
}

/**
 * The facts the Divers tab shows. None on a finished departure, whose tab is
 * its record (UX review 2026-10-10, item 10). While the desk's count is on
 * screen it says "1 blocked" itself, so the pulse's door to
 * the same rows stands down. Only that door: the boat's work (a missing
 * emergency contact also opens the roster) is not on the desk's count.
 */
export function shownPulseFacts(
  facts: readonly TripPulseFact[],
  { desk, finished }: { desk: { arrival: { instrument?: unknown } } | null; finished: boolean },
): readonly TripPulseFact[] {
  if (finished) return [];
  return desk?.arrival.instrument
    ? facts.filter((fact) => !(fact.tone === "danger" && fact.href.endsWith("#roster")))
    : facts;
}
