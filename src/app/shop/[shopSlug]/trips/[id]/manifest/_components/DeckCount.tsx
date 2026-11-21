import { DECK_COUNT_MAX, type DeckCountComparison } from "@/features/boarding/deck-counts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DeckCountAction, DeckCountForm } from "./DeckCountForm";

/**
 * **The deck count's line** (issue #4248), under the roll call's progress:
 * said only when the count on deck and the people marked aboard differ, in
 * plain words and warning ink, never danger. It informs a human and never
 * blocks a departure, so it carries no action of its own.
 */
export function DeckCountNote({
  comparison,
  t,
}: {
  comparison: DeckCountComparison | null;
  t: StaffTranslator;
}) {
  if (comparison?.kind !== "differs") return null;
  return (
    <p className="mt-1 text-base font-semibold text-warning-strong tabular-nums" role="status">
      {t("manifest.deckCount.differs", {
        counted: comparison.counted,
        aboard: comparison.aboard,
      })}
    </p>
  );
}

/** The form, and the agreeing count said beside it, in the deck's details. */
export function DeckCountPanel({
  action,
  counted,
  comparison,
  t,
}: {
  action: DeckCountAction;
  counted: number | null;
  comparison: DeckCountComparison | null;
  t: StaffTranslator;
}) {
  return (
    <section className="rounded-panel border border-border">
      <DeckCountForm
        action={action}
        counted={counted}
        max={DECK_COUNT_MAX}
        copy={{
          label: t("manifest.deckCount.label"),
          save: t("manifest.deckCount.save"),
          saving: t("words.busy.saving"),
          invalid: t("manifest.deckCount.invalid"),
          error: t("manifest.deckCount.error"),
        }}
      />
      {comparison?.kind === "matches" ? (
        <p className="px-4 pb-3 text-sm text-muted tabular-nums">
          {t("manifest.deckCount.matches", { counted: comparison.counted })}
        </p>
      ) : null}
    </section>
  );
}
