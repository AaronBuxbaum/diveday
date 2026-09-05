import { groupLabelClass } from "@/components/ui/ledger";
import type { FactSource as FactSourceKind } from "@/lib/fact-source";

/**
 * **Where a mutable fact came from, said in one chip** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 5 (D51): Forecast
 * (hollow), Plan (lagoon), Crew with a time (ink), Observed (success).
 *
 * The whole chip is muted; only the dot takes the source's ink. That is the
 * rule rather than a taste call — provenance is a footnote on a fact, and a
 * row of coloured words down a page would make the footnote louder than the
 * thing it annotates.
 *
 * **Not a `Badge`.** A Badge is the app's one filled status pill and marks an
 * exceptional state (ADR 20260827-clearwater-surface-language, decision 3);
 * where a fact came from is not a state, and "a wash is not a status".
 *
 * **The word always renders**, the same commitment `SettledCheck` makes with
 * its required label: colour never carries a state alone, and here the colour
 * is the *only* other thing distinguishing four otherwise identical dots. So
 * `label` is a required prop rather than an option, and this file holds no
 * copy — the caller resolves the code through
 * `src/i18n/fact-source-labels.ts`.
 *
 * Forecast is the hollow one because nobody stands behind it: a model read the
 * weather. The other three each have somebody's hand on them.
 *
 * The word takes `groupLabelClass()` rather than a hand-rolled small-caps
 * string: it is the app's one spelling for a label set in small caps, and a
 * copy here would be exactly the drift `ledger.test.tsx` sweeps for.
 */
const SOURCE_DOT: Record<FactSourceKind, string> = {
  forecast: "border border-border-strong",
  plan: "bg-primary",
  crew: "bg-foreground",
  observed: "bg-success",
};

export function FactSource({
  kind,
  label,
  at,
  className = "",
}: {
  kind: FactSourceKind;
  /** The source in the reader's own language. Always rendered, never optional. */
  label: string;
  /**
   * When the crew said it — already formatted by the caller through
   * `src/lib/format.ts`'s `formatDateTimeTz`, in the shop's own zone. Only
   * `crew` normally carries one: a stage called at 07:40 stops being news by
   * noon, and a plan's own timestamp is the change ledger's to state.
   */
  at?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${groupLabelClass()} ${className}`.trim()}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${SOURCE_DOT[kind]}`} />
      {at ? `${label} · ${at}` : label}
    </span>
  );
}
