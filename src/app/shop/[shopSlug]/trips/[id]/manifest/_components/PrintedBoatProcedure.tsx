import {
  EmergencyReferenceCard,
  type EmergencyReferenceCopy,
} from "@/components/EmergencyReferenceCard";
import type { DepartureKitRecord } from "@/db/boat-safety";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { scopedId } from "@/lib/element-id";
import type { DepartureEmergencyReference } from "@/lib/emergency-reference";
import { formatDateWithYear } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";

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
 * DiveDay invents none of these facts: a value it made up is worse than a
 * rule to write on, because the crew who trusts it spends the minute finding
 * out (issue #688). What the shop's own gear register holds about this hull's
 * kit is printed in place of its blank (fourth review, item 17), and every
 * line the register cannot answer stays a blank, the oxygen pressure always.
 * Paper only; the screen has the live manifest.
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

/** What the register says for each kit line, worded; null where the line stays a blank. */
export type PrintedKitValues = {
  oxygenKept: string | null;
  firstAidKept: string | null;
  lastChecked: string | null;
};

/** The register's record for this departure's boat, in the packet's words. */
export function printedKitValues(
  record: DepartureKitRecord | null,
  t: StaffTranslator,
  locale: string,
): PrintedKitValues {
  const kept = (kits: readonly string[]) =>
    record && kits.length > 0
      ? t("print.packet.keptAboard", {
          boat: record.boatName,
          kits: cachedListFormat(locale, { type: "conjunction" }).format(kits),
        })
      : null;
  return {
    oxygenKept: kept(record?.oxygenKits ?? []),
    firstAidKept: kept(record?.firstAidKits ?? []),
    // A calendar date with no instant in it: formatted through UTC midnight.
    lastChecked: record?.oxygenLastCheckedOn
      ? formatDateWithYear(calendarDateToUtcMidnight(record.oxygenLastCheckedOn), locale, "UTC")
      : null,
  };
}

/**
 * Ruled blanks to fill in by hand, under the shop's numbers, each filled from
 * the register where it holds the fact. The oxygen pressure sits beside the
 * date of the check it was read at: one line, one check.
 */
export function PrintedKitBlanks({
  copy,
  headingId,
  values = { oxygenKept: null, firstAidKept: null, lastChecked: null },
}: {
  copy: PrintedBoatProcedureCopy;
  /** Unique per departure: the day's paper prints several manifests. */
  headingId: string;
  values?: PrintedKitValues;
}) {
  const lines: [string, string | null][][] = [
    [[copy.oxygenKept, values.oxygenKept]],
    [[copy.firstAidKept, values.firstAidKept]],
    [
      [copy.lastChecked, values.lastChecked],
      [copy.oxygenPressure, null],
    ],
  ];
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className="text-base font-semibold">
        {copy.kitHeading}
      </h2>
      <dl className="mt-2 space-y-3 text-sm">
        {lines.map((pairs) => (
          // A `dl` row may hold several term and blank pairs, and no deeper
          // wrapper: each pair is a `dt` and its own growing `dd`.
          <div key={pairs.map(([label]) => label).join("|")} className="flex items-end gap-2">
            {pairs.flatMap(([label, value], index) => [
              <dt key={`${label}-term`} className={index > 0 ? "shrink-0 ps-2" : "shrink-0"}>
                {label}
              </dt>,
              <dd key={`${label}-value`} className="min-w-0 flex-1">
                {value ? (
                  <span className="block border-b border-border-strong font-medium">{value}</span>
                ) : (
                  <span data-print-blank className="block h-5 border-b border-border-strong" />
                )}
              </dd>,
            ])}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * **The boat card on paper**: the missing-diver procedure above the numbers
 * it sends the crew to, the departure's emergency reference, and the kit
 * lines under them (issue #2035; the departure's own boat and its register,
 * fourth review items 11 and 17). Print only: on screen the reference sits
 * behind the manifest's own menus, and this is its complete copy outside
 * either disclosure.
 */
export function PrintedBoatPaper({
  idPrefix,
  reference,
  emergencyCopy,
  copy,
  kit,
}: {
  /** Scopes the three headings: the day's paper prints several manifests. */
  idPrefix: string | undefined;
  reference: DepartureEmergencyReference;
  emergencyCopy: EmergencyReferenceCopy;
  copy: PrintedBoatProcedureCopy;
  kit: PrintedKitValues;
}) {
  return (
    <div className="hidden print:block">
      <PrintedMissingProcedure
        copy={copy}
        headingId={scopedId(idPrefix, "missing-procedure-print-heading")}
      />
      <EmergencyReferenceCard
        headingId={scopedId(idPrefix, "emergency-reference-print-heading")}
        reference={reference}
        copy={emergencyCopy}
      />
      <PrintedKitBlanks
        copy={copy}
        values={kit}
        headingId={scopedId(idPrefix, "kit-blanks-print-heading")}
      />
    </div>
  );
}
