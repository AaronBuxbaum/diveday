import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import type { BoatLineMark } from "@/lib/boat-line";

/**
 * **One departure's day, drawn once** — ADR 20260908-one-hand, decision 6,
 * lever U (the line itself is round 3's L).
 *
 * Check-in opens, the boat leaves, each site in the plan, back — with the mark
 * on each step coming from the word the crew tapped. The dot is the whole
 * state vocabulary: filled for a step the day is past, filled and ringed for
 * the one the boat is on, hollow for one still ahead. No pill, no colour
 * beyond lagoon, and nothing that reads as an alarm: a boat running late is
 * exactly the reader this page has, and Reef's coral bans hold on a page about
 * a boat at sea.
 */
export function BoatLine({
  heading,
  steps,
}: {
  heading: string;
  steps: readonly { key: string; time: string; label: string; mark: BoatLineMark }[];
}) {
  return (
    <section className="mt-8">
      <GroupLabel as="h2">{heading}</GroupLabel>
      <ol className="mt-2 flex flex-col">
        {steps.map((step) => (
          <LedgerRow
            key={step.key}
            leading={<BoatLineDot mark={step.mark} />}
            trailing={<span className="text-sm text-muted tabular-nums">{step.time}</span>}
          >
            <span
              className={step.mark === "todo" ? "text-base text-muted" : "text-base font-medium"}
            >
              {step.label}
            </span>
          </LedgerRow>
        ))}
      </ol>
    </section>
  );
}

/**
 * The one mark this page draws. Wordless on purpose: the row already says what
 * the step is and when, and a second label for "done" would be DiveDay
 * narrating a shop's morning. The ring on `now` is the only emphasis.
 *
 * **Every mark sits in the ring's 16px box** (K-379). A bare 8px dot beside
 * the 16px ring put "Check-in" 8px right of "Leaves" and the dots on two
 * centre lines; in one box the dots share a centre and the labels one edge.
 */
function BoatLineDot({ mark }: { mark: BoatLineMark }) {
  return (
    <span
      className={`flex size-4 items-center justify-center rounded-full${
        mark === "now" ? " bg-primary-tint" : ""
      }`}
    >
      <span
        className={`size-2 rounded-full ${
          mark === "todo" ? "border border-border bg-surface" : "bg-primary"
        }`}
      />
    </span>
  );
}
