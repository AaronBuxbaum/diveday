import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentCertificationEvidence } from "@/lib/incident-export";
import type { CertificationLevel } from "@/lib/readiness";

/**
 * Stands in for the card number while the line is translated, so the result
 * can be split around it and the number set whole. A private-use character,
 * which no message and no agency or level name will ever contain.
 */
const NUMBER_SLOT = "\u{E000}";

/**
 * The line's separator, glued to what it follows by a no-break space: a wrap
 * falls after a dot, never before one, so no line of the evidence starts with
 * "· Certified". The messages' own joins carry the same glue in the bundles,
 * where a translator sees it; this component sets the message as written.
 */
const SEPARATOR = "\u00a0· ";

/** One held card, as the shop's records state it. */
export function CertificationLine({
  t,
  card,
  agencyText,
  dateTime,
}: {
  t: StaffTranslator;
  card: IncidentCertificationEvidence;
  agencyText: (agency: string) => string;
  dateTime: (isoString: string) => string;
}) {
  const levelKey = card.level
    ? CERTIFICATION_LEVEL_KEYS[card.level as CertificationLevel]
    : undefined;
  const specialtyKey = card.specialty
    ? SPECIALTY_KEYS[card.specialty as keyof typeof SPECIALTY_KEYS]
    : undefined;
  // A self-declared card has no number the shop holds, and "absence is stated,
  // never blank" is rule 2 of this document (src/lib/incident-export.ts) — a
  // bare gap where a card number belongs reads as a missing page to an
  // investigator. The card is separately tagged as the diver's own word below.
  //
  // **A number the shop holds never breaks.** "PADI-12-3456" wrapped at its
  // hyphens on a phone, on the document an investigator reads a number aloud
  // from, so it is set whole in a `whitespace-nowrap` span — the rule the
  // emergency phone takes on the roster (issue #1035). Never non-breaking
  // hyphens instead: a number copied off this page has to match the card.
  // The no-number phrase is words, and wraps like them.
  const identifier = card.identifier ? NUMBER_SLOT : t("incidentExport.certNoNumber");
  const translated =
    card.kind === "level" && levelKey
      ? t("incidentExport.certLevelLine", {
          agency: agencyText(card.agency),
          level: t(levelKey),
          identifier,
        })
      : card.kind === "specialty" && specialtyKey
        ? t("incidentExport.certSpecialtyLine", {
            agency: agencyText(card.agency),
            specialty: t(specialtyKey),
            identifier,
          })
        : t("incidentExport.certNitroxLine", {
            agency: agencyText(card.agency),
            identifier,
          });
  const line = translated.split(NUMBER_SLOT).flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          // biome-ignore lint/suspicious/noArrayIndexKey: the message's own order, never reordered
          <span key={index} className="whitespace-nowrap">
            {card.identifier}
          </span>,
          part,
        ],
  );
  const status =
    card.status === "verified"
      ? card.reviewedAt
        ? card.reviewedByName
          ? t("incidentExport.certStatusVerifiedBy", {
              date: dateTime(card.reviewedAt),
              name: card.reviewedByName,
            })
          : t("incidentExport.certStatusVerifiedUnknownReviewer", {
              date: dateTime(card.reviewedAt),
            })
        : t("incidentExport.certStatusVerifiedNoDate")
      : t("incidentExport.certStatusPending");
  return (
    <>
      {line}
      {SEPARATOR}
      {status}
      {card.imported ? (
        <>
          {SEPARATOR}
          {t("incidentExport.certImportedTag")}
        </>
      ) : null}
      {/* The weakest thing on the page, and it has to read that way. */}
      {card.selfDeclared ? (
        <>
          {SEPARATOR}
          {t("incidentExport.certSelfDeclaredTag")}
        </>
      ) : null}
    </>
  );
}
