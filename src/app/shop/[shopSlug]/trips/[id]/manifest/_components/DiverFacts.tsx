import Link from "next/link";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import { ridingOnlyMedicalSentences, trainingDiveLines } from "@/i18n/manifest-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatShortDate } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";
import type { ReadinessBlocker } from "@/lib/readiness";
import { medicalWarningDays } from "@/lib/waivers";

/**
 * A blocker's sentence on this diver's row: the crew's (`crewBlockerText`).
 * A held seat says the desk must settle it, and that other holds may still
 * apply when withholding dropped any, without naming the matched person or
 * which hold it was (dive-domain review 2026-10-06). "Confirm who this is"
 * stays on the Divers tab, beside the control that does it.
 */
export function diverBlockerText(
  t: StaffTranslator,
  diver: TripManifest["divers"][number],
  blocker: ReadinessBlocker,
): string {
  return crewBlockerText(t, diver, blocker);
}

/**
 * The reference half of a diver's row — emergency contact, rental fit, medical
 * evidence. None of it is roll call: the row's job at the rail is name, state,
 * one tap, and these facts have their moment either before the boat leaves
 * (Prep owns chasing gaps) or when something has gone wrong (one tap away, and
 * always on the paper the boat carries). Rendered twice per row: inside the
 * screen-only person sheet, and in a print-only block — the sheet contributes
 * nothing to print, and the printed manifest is the document a coastguard
 * reads, so it keeps every fact without asking paper to disclose.
 *
 * The one exception is a held seat (`identityWithheld`, issue #1690): the
 * facts on file belong to the matched person, not provably to whoever is
 * aboard, so paper says they wait for confirmation, exactly as the screen does.
 * A wrong next of kin on the coastguard's sheet is worse than none.
 */
export function DiverFacts({
  diver,
  locale,
  timezone,
  columns,
  waiverHref,
  contactClassName = "",
  t,
}: {
  diver: TripManifest["divers"][number];
  locale: string;
  timezone: string;
  /**
   * How much width these facts have, which differs by a factor of two between
   * the two places they render — and the answer is not the same in both.
   *
   * `1` is the on-screen panel, inset inside the row: a second column there
   * wrapped "a contact (sister) · <phone number>" mid-number.
   *
   * `2` is paper, which has the whole page and no disclosure beside it. Single
   * column there leaves the right half of a US-Letter sheet blank and stretches
   * a nine-diver roster far enough to spill onto another page — more sheets for
   * a boat to carry and lose, to buy width nothing needed.
   */
  columns: 1 | 2;
  /**
   * Where a medical-history warning links to the record it is about, on
   * screen only: an unanswered referral (issue #2195) and an earlier refusal
   * (issue #2348). Paper has nothing to tap. Absent, both are drawn unlinked.
   */
  waiverHref?: (record: { personId: string; recordId: string }) => string;
  /**
   * The emergency contact's own box, on screen (visual review 2026-10-24,
   * B08): the card holds contact facts only, and every other fact sits
   * beside it. Paper passes nothing.
   */
  contactClassName?: string;
  t: StaffTranslator;
}) {
  // The pickup belongs to the booking, not to the matched person, so a held
  // seat keeps it.
  // The two warning days, in the shop's zone and with the year: the refusal by
  // the physician's evaluation (dive-domain review of #2163).
  const warningDays = medicalWarningDays(diver.medicalWaiver, timezone, diver.riderMedicalHold);
  // A rider boarding riding only under a medical hold (H-109): said in full on
  // screen and paper alike, with no medical mark to hang it on.
  const ridingOnly = ridingOnlyMedicalSentences(t, warningDays, (day) =>
    formatCalendarDate(day, locale),
  );
  const training = trainingDiveLines(t, diver);
  const pickup = diver.hotelPickupLocation ? (
    <p>
      <span className="font-bold">{t("manifest.hotelPickupLabel")}</span>
      <span className="mt-0.5 block text-muted">
        {diver.hotelPickupLocation}
        {diver.pickupTime ? ` · ${diver.pickupTime}` : ""}
      </span>
    </p>
  ) : null;
  if (diver.identityWithheld) {
    // Said, on screen and on paper alike, rather than "Not on file": a held
    // seat with no contact reads as a diver who has none, which is a wrong
    // fact. The confirm control is ashore, on the Divers tab (issue #1690).
    // The one contact a held seat carries is the one the desk recorded for
    // the person on it (issue #2145), never the matched record's.
    return (
      <div className={`grid gap-2 text-base${columns === 2 ? " sm:grid-cols-2" : ""}`}>
        <p className="text-muted">{t("manifest.identityWithheldDetails")}</p>
        {/* Its own field, never `emergencyContact*` (H7, Y3). */}
        {diver.heldEmergencyContact ? (
          <p className={contactClassName}>
            <span className="font-bold">{t("manifest.heldEmergencyContactLabel")}</span>
            <span className="mt-0.5 block text-muted">
              {diver.heldEmergencyContact.name} ·{" "}
              <span className="whitespace-nowrap">{diver.heldEmergencyContact.phone}</span>
            </span>
          </p>
        ) : null}
        {pickup}
      </div>
    );
  }
  return (
    <div className={`grid gap-2 text-base${columns === 2 ? " sm:grid-cols-2" : ""}`}>
      <p className={contactClassName}>
        <span className="font-bold">{t("manifest.emergencyContactLabel")}</span>
        <span className="mt-0.5 block text-muted">
          {diver.emergencyContactName && diver.emergencyContactPhone ? (
            columns === 1 ? (
              <>
                {diver.emergencyContactName} ·{" "}
                {/* Reference text, never a `tel:` link — there are no call
                    buttons anywhere on the boat (ADR
                    20260827-the-departure-is-two-working-surfaces, decision 3):
                    a control that can dial by accident buys nothing on a path
                    used less than once a year and costs a false alarm the one
                    time it misfires.
                    The number never breaks across lines *here*. In the narrow
                    panel it wrapped at its own hyphens — "<phone>" / "<number>"
                    — and a number a crew member reads aloud in an emergency is
                    the last string on this page that should be reassembled by
                    eye.
                    Only here: the `<span>` splits one text run into two, which
                    the browser then shapes independently, and on paper that
                    re-drew every phone number a few sub-pixels over for a wrap
                    that a full-width page never had. The printed manifest is
                    the document a coastguard reads — it does not move for a
                    problem it does not have. */}
                <span className="whitespace-nowrap">{diver.emergencyContactPhone}</span>
              </>
            ) : (
              `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
            )
          ) : (
            t("manifest.notOnFile")
          )}
        </span>
      </p>
      {/* Only when there is something to load or a note to read:
          "No fit on file — not asked yet" printed on most rows
          is the absence of information formatted as information
          (principle 9), and Prep owns chasing the gap. A nitrox
          request always shows — that's an operational fact. */}
      {/* A rider takes nothing from the rack (ADR 20261007-participant-types). */}
      {diver.participantType !== "rider" &&
      (diver.rentalFit.state !== "not_recorded" || diver.nitroxRequested) ? (
        <p>
          <span className="font-bold">{t("manifest.rentalFitLabel")}</span>
          <span className="mt-0.5 block text-muted">
            {rentalFitLineText(t, locale, diver.rentalFit)}
            {diver.nitroxRequested ? t("manifest.nitroxRequestedSuffix") : ""}
          </span>
        </p>
      ) : null}
      {pickup}
      {diver.dietaryNote ? (
        <p>
          <span className="font-bold">{t("manifest.dietaryNoteLabel")}</span>
          <span className="mt-0.5 block text-muted break-words">{diver.dietaryNote}</span>
        </p>
      ) : null}
      {ridingOnly.length > 0 ? (
        <p className="font-medium text-warning-strong">
          {ridingOnly.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {/* A training dive (issue #2275): the course it counts toward, then
          the warnings — no instructor aboard, or a mark cleared with its
          course forms unsigned, naming who decided. */}
      {training.fact ? <p>{training.fact}</p> : null}
      {training.warnings.length > 0 ? (
        <p className="font-medium text-warning-strong">
          {training.warnings.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {diver.medicalWaiver ? (
        <p>
          <span className="font-bold">
            {diver.medicalWaiver.source === "paper"
              ? t("manifest.medicalReviewedPaper")
              : diver.medicalWaiver.source === "imported"
                ? t("manifest.medicalClearanceImported")
                : diver.medicalWaiver.source === "cleared"
                  ? // The questionnaire referred this diver and a physician
                    // cleared them. A crew member reading the manifest at the
                    // rail is entitled to know that, rather than seeing it
                    // spelled the same as a self-declaration (issue #1252).
                    t("manifest.medicalClearedByPhysician")
                  : t("manifest.medicalWaiverSigned")}
          </span>
          <span className="mt-0.5 block text-muted">
            {formatShortDate(diver.medicalWaiver.at, locale, timezone)}
          </span>
          {/* A minor's release names who co-signed it (ADR
              20260907-guardian-co-signature): the crew reading the rail is
              entitled to know the release was countersigned, not just dated. */}
          {diver.medicalWaiver.guardian ? (
            <span className="mt-0.5 block text-muted">
              {guardianCoSignedText(t, diver.medicalWaiver.guardian)}
            </span>
          ) : null}
          {/* An earlier release was refused by a physician, and this one
              cleared the diver without a second physician (issue #2158). Not
              a block; the crew at the rail decides with it in view. */}
          {diver.medicalWaiver.overriddenRefusal ? (
            <span className="mt-0.5 block font-medium text-warning-strong">
              {t("manifest.medicalEarlierRefusal", {
                date: formatCalendarDate(warningDays.refusedOn ?? "", locale),
              })}
              {/* The refused record, one tap away, as the weaker referral
                  warning below already is (issue #2348). */}
              {waiverHref ? (
                <>
                  {" "}
                  <Link
                    href={waiverHref(diver.medicalWaiver.overriddenRefusal)}
                    className="font-semibold text-primary hover:underline"
                  >
                    {t("manifest.medicalRefusalLink")}
                  </Link>
                </>
              ) : null}
            </span>
          ) : null}
          {/* The signature standing here replaced a referral instead of
              answering it — nobody's fault, and not a block, but a crew member
              at the rail is the person best placed to ask (issue #1282). */}
          {diver.medicalWaiver.overriddenReferralAt ? (
            <span className="mt-0.5 block font-medium text-warning-strong">
              {t("manifest.medicalReferralUnresolved", {
                date: formatCalendarDate(warningDays.referredOn ?? "", locale),
              })}
              {/* The override stands, and the warning links back to the
                  referral (Aaron, 2026-10-09, issue #2195, amending H-98). */}
              {waiverHref && diver.medicalWaiver.overriddenReferral ? (
                <>
                  {" "}
                  <Link
                    href={waiverHref(diver.medicalWaiver.overriddenReferral)}
                    className="font-semibold text-primary hover:underline"
                  >
                    {t("manifest.medicalReferralLink")}
                  </Link>
                </>
              ) : null}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
