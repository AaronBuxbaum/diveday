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
 * The boat card's procedure and writable kit fields, on the printed manifest
 * (issue #2035).
 *
 * ADR 20261001-logbook removed the card; the packet retains the shop's
 * emergency reference. The printed manifest also carries the missing-diver
 * procedure and ruled fields for kit locations, check date, and oxygen
 * pressure.
 *
 * Do not invent values for the blanks (issue #688). Register facts about this
 * hull's kits appear on their own line; they do not answer where the kits are
 * aboard or what the crew's check measured. This is print-only; the screen
 * shows the live manifest.
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
 * The register's facts about this departure's kit, as one line: the units
 * aboard by their labels, and the newest oxygen kit service. Null when the
 * departure is on no boat or the register holds nothing aboard it.
 */
export function printedKitRegister(
  record: DepartureKitRecord | null,
  t: StaffTranslator,
  locale: string,
): string | null {
  if (!record) return null;
  const units = [...record.oxygenKits, ...record.firstAidKits];
  if (units.length === 0) return null;
  const kits = cachedListFormat(locale, { type: "conjunction" }).format(units);
  if (!record.oxygenServicedOn) {
    return t("print.packet.kitRegister", { kits, boat: record.boatName });
  }
  return t("print.packet.kitRegisterServiced", {
    kits,
    boat: record.boatName,
    // A calendar date with no instant in it: formatted through UTC midnight.
    date: formatDateWithYear(calendarDateToUtcMidnight(record.oxygenServicedOn), locale, "UTC"),
  });
}

/**
 * Ruled blanks to fill in by hand, under the shop's numbers, with the
 * register's line above them when it holds anything. The oxygen pressure sits
 * beside the date of the check it was read at: one line, one check.
 */
export function PrintedKitBlanks({
  copy,
  headingId,
  register = null,
}: {
  copy: PrintedBoatProcedureCopy;
  /** Unique per departure: the day's paper prints several manifests. */
  headingId: string;
  register?: string | null;
}) {
  const lines: string[][] = [
    [copy.oxygenKept],
    [copy.firstAidKept],
    [copy.lastChecked, copy.oxygenPressure],
  ];
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className="text-base font-semibold">
        {copy.kitHeading}
      </h2>
      {register ? <p className="mt-1 text-sm">{register}</p> : null}
      <dl className="mt-2 space-y-3 text-sm">
        {lines.map((labels) => (
          // A `dl` row may hold several term and blank pairs, and no deeper
          // wrapper: each pair is a `dt` and its own growing `dd`.
          <div key={labels.join("|")} className="flex items-end gap-2">
            {labels.flatMap((label, index) => [
              <dt key={`${label}-term`} className={index > 0 ? "shrink-0 ps-2" : "shrink-0"}>
                {label}
              </dt>,
              <dd key={`${label}-value`} className="min-w-0 flex-1">
                <span data-print-blank className="block h-5 border-b border-border-strong" />
              </dd>,
            ])}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Print-only composition: missing-diver procedure, emergency reference, and
 * kit lines for this departure's boat and register (issue #2035; review items
 * 11 and 17). The screen reference remains behind the manifest menus.
 */
export function PrintedBoatPaper({
  idPrefix,
  reference,
  emergencyCopy,
  copy,
  kitRegister,
}: {
  /** Scopes the three headings: the day's paper prints several manifests. */
  idPrefix: string | undefined;
  reference: DepartureEmergencyReference;
  emergencyCopy: EmergencyReferenceCopy;
  copy: PrintedBoatProcedureCopy;
  kitRegister: string | null;
}) {
  return (
    <div data-print-only className="hidden print:block print:break-inside-avoid">
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
        register={kitRegister}
        headingId={scopedId(idPrefix, "kit-blanks-print-heading")}
      />
    </div>
  );
}
