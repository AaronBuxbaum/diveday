import Link from "next/link";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { TripPulseFact } from "./TripPulse";

const FACT_LINK_CLASS =
  "-my-3 inline-flex min-h-11 items-center text-sm font-medium hover:underline";

function FactLink({ fact }: { fact: TripPulseFact }) {
  return (
    <Link
      href={fact.href}
      className={`${FACT_LINK_CLASS} ${fact.tone === "danger" ? "text-danger" : "text-primary"}`}
    >
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
 * line: a missing instructor or a boat clash is never one tap deep. The rest
 * (rental sizes to take, orders awaiting payment) are work, not hazards: one
 * of them renders as its own link, and two or more fold into one line, "2
 * things to sort", that opens to the same links. Not "before boarding": an
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
}: {
  facts: readonly TripPulseFact[];
  /** "2 things to sort", already counted for the folded facts. */
  foldLabel: (count: number) => string;
}) {
  if (facts.length === 0) return null;
  const hazards = facts.filter((fact) => fact.tone === "danger");
  const work = facts.filter((fact) => fact.tone !== "danger");
  const fold = work.length > 1;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-7">
      {hazards.map((fact) => (
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
          <div className="mt-5 flex flex-col gap-y-7 ps-5">
            {work.map((fact) => (
              <FactLink key={fact.href} fact={fact} />
            ))}
          </div>
        </details>
      ) : (
        work.map((fact) => <FactLink key={fact.href} fact={fact} />)
      )}
    </div>
  );
}
