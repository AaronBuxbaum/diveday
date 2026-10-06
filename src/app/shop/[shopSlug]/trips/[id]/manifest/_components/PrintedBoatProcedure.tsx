import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **What the laminated boat card carried, on the printed manifest** (issue
 * #2035, Aaron's yes on 2026-10-05).
 *
 * ADR 20261001-logbook cut the boat card, and the packet kept the shop's own
 * emergency reference (`EmergencyReferenceCard`). Two things the card printed
 * then printed nowhere: DiveDay's missing-diver procedure, and ruled blanks
 * for where the oxygen and first aid kits are kept, when they were last
 * checked, and the oxygen cylinder's pressure at that check.
 * Both sit beside the reference on the paper copy of the manifest, which is
 * what the trip packet and the day's paper compose, so either printout carries
 * them.
 *
 * The blanks stay blanks: DiveDay holds none of these facts, and a value it
 * invented is worse than a rule to write on, because the crew who trusts it
 * spends the minute finding out (issue #688). Paper only; the screen has the
 * live manifest.
 */
export type PrintedBoatProcedureCopy = {
  missingHeading: string;
  missing: string;
  kitHeading: string;
  oxygenKept: string;
  firstAidKept: string;
  lastChecked: string;
  oxygenPressure: string;
};

export function printedBoatProcedureCopy(t: StaffTranslator): PrintedBoatProcedureCopy {
  return {
    missingHeading: t("print.packet.missingHeading"),
    missing: t("print.packet.missing"),
    kitHeading: t("print.packet.kitHeading"),
    oxygenKept: t("print.packet.oxygenKept"),
    firstAidKept: t("print.packet.firstAidKept"),
    lastChecked: t("print.packet.lastChecked"),
    oxygenPressure: t("print.packet.oxygenPressure"),
  };
}

/**
 * The procedure, above the shop's numbers. It does not depend on them: the
 * radio call comes first and needs no number, because the shop's own numbers
 * may not be printed (dive-domain review). It then says "the numbers below",
 * so it is placed where that is true when they are.
 */
export function PrintedMissingProcedure({
  copy,
  headingId,
}: {
  copy: PrintedBoatProcedureCopy;
  /** Unique per departure: the day's paper prints several manifests. */
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className="text-base font-semibold">
        {copy.missingHeading}
      </h2>
      <p className="mt-1 text-sm">{copy.missing}</p>
    </section>
  );
}

/**
 * Ruled blanks to fill in by hand, under the shop's numbers. The oxygen
 * pressure sits beside the date of the check it was read at: one line, one
 * check.
 */
export function PrintedKitBlanks({
  copy,
  headingId,
}: {
  copy: PrintedBoatProcedureCopy;
  /** Unique per departure: the day's paper prints several manifests. */
  headingId: string;
}) {
  const lines = [[copy.oxygenKept], [copy.firstAidKept], [copy.lastChecked, copy.oxygenPressure]];
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className="text-base font-semibold">
        {copy.kitHeading}
      </h2>
      <dl className="mt-2 space-y-3 text-sm">
        {lines.map((labels) => (
          // A `dl` row may hold several term and blank pairs, and no deeper
          // wrapper: each pair is a `dt` and its own growing `dd`.
          <div key={labels.join("|")} className="flex items-end gap-2">
            {labels.flatMap((label, index) => [
              <dt key={`${label}-term`} className={index > 0 ? "shrink-0 ps-2" : "shrink-0"}>
                {label}
              </dt>,
              <dd key={`${label}-blank`} className="min-w-0 flex-1">
                <span data-print-blank className="block h-5 border-b border-border-strong" />
              </dd>,
            ])}
          </div>
        ))}
      </dl>
    </section>
  );
}
