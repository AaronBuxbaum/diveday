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
 * Shows trip facts above the Divers tab's head count.
 *
 * Danger facts remain individually visible, followed by individually visible
 * warnings. Work facts such as rental sizes and payment orders are not hazards:
 * one stays a link, while multiple facts fold into a count that opens the same
 * links. Payment is work, not a boarding gate.
 *
 * The 44px links use `-my-3` to keep the flex row at text height; `gap-y-7`
 * keeps wrapped targets clear while preserving their hit area.
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
 * Group chips by kind in first-seen order. Single facts keep their text; groups
 * show a count. Shared destinations stay linked directly, while mixed
 * destinations go to the roster so every affected diver remains reachable.
 */
export function pulseChips(work: readonly TripPulseFact[], rosterHref: string): PulseChip[] {
  const chips: PulseChip[] = [];
  const byKind = new Map<string, PulseChip>();
  for (const fact of work) {
    const group = fact.chip?.group;
    const existing = group === undefined ? undefined : byKind.get(group);
    if (existing) {
      existing.facts.push(fact);
      if (existing.href !== fact.href) existing.href = rosterHref;
      continue;
    }
    const chip: PulseChip = {
      key: group ?? fact.key ?? fact.href,
      href: fact.href,
      kind: fact.chip?.kind,
      icon: fact.chip?.icon,
      tone: fact.chip?.tone,
      facts: [fact],
    };
    chips.push(chip);
    if (group !== undefined) byKind.set(group, chip);
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
