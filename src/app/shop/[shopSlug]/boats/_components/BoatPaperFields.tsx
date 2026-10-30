import { controlClass, DateField, Field } from "@/components/ui/form";
import type { Boat } from "@/db/boats";
import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  boatCapacityAboveTotalPersons,
  boatPaperNotices,
  boatSafetyNoticeTone,
} from "@/lib/boat-safety";
import { MAX_CALL_SIGN_LENGTH, MAX_WORKING_CHANNEL_LENGTH } from "@/lib/emergency-reference";

/**
 * **The certificate and the paper dates** (roadmap N-10), under the boat's
 * own line: the passenger limit, the total-persons limit with the crew and the
 * certificate's own expiry (#2302), then the three dates the boat renews.
 * Captioned, because a date box with only a placeholder says nothing once it
 * holds a date. All optional: an empty box is a boat the shop has not dated,
 * and nothing reads it as expired.
 *
 * The boat's radio identity sits with its papers (fourth review, item 11):
 * call sign and MMSI, the facts the departure's emergency card prints in
 * place of the shop-wide vessel line.
 */
export function BoatPaperFields({
  boat,
  t,
  className = "",
  invalid = false,
  radioInvalid = false,
  channelInvalid = false,
  describedBy,
}: {
  boat?: Boat;
  t: StaffTranslator;
  className?: string;
  /** The row's certificate error (H-107): the limit box is half of it. */
  invalid?: boolean;
  /** The radio identity failed validation, rather than a certificate limit. */
  radioInvalid?: boolean;
  /** A working channel reserved for distress/calling was refused. */
  channelInvalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      className={`grid w-full grid-cols-1 gap-3 sm:basis-full sm:grid-cols-2 ${className}`.trim()}
    >
      <Field label={t("boats.certifiedPassengersLabel")}>
        <input
          name="certifiedPassengers"
          type="number"
          min={1}
          max={999}
          inputMode="numeric"
          defaultValue={boat?.certifiedPassengers ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedBy : undefined}
          className={`${controlClass} tabular-nums`}
        />
      </Field>
      <Field label={t("boats.certifiedTotalPersonsLabel")}>
        <input
          name="certifiedTotalPersons"
          type="number"
          min={1}
          max={999}
          inputMode="numeric"
          defaultValue={boat?.certifiedTotalPersons ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedBy : undefined}
          className={`${controlClass} tabular-nums`}
        />
      </Field>
      <Field label={t("boats.coiExpiresLabel")}>
        <DateField name="coiExpiresOn" defaultValue={boat?.coiExpiresOn ?? ""} />
      </Field>
      <Field label={t("boats.inspectionDueLabel")}>
        <DateField name="inspectionDueOn" defaultValue={boat?.inspectionDueOn ?? ""} />
      </Field>
      <Field label={t("boats.registrationExpiresLabel")}>
        <DateField name="registrationExpiresOn" defaultValue={boat?.registrationExpiresOn ?? ""} />
      </Field>
      <Field label={t("boats.insuranceExpiresLabel")}>
        <DateField name="insuranceExpiresOn" defaultValue={boat?.insuranceExpiresOn ?? ""} />
      </Field>
      <Field label={t("boats.callSignLabel")}>
        <input
          name="callSign"
          type="text"
          maxLength={MAX_CALL_SIGN_LENGTH}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          defaultValue={boat?.callSign ?? ""}
          aria-invalid={radioInvalid || undefined}
          aria-describedby={radioInvalid ? describedBy : undefined}
          className={`${controlClass} font-mono uppercase`}
        />
      </Field>
      <Field label={t("boats.mmsiLabel")} description={t("boats.mmsiHint")}>
        <input
          name="mmsi"
          type="text"
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          defaultValue={boat?.mmsi ?? ""}
          aria-invalid={radioInvalid || undefined}
          aria-describedby={radioInvalid ? describedBy : undefined}
          className={`${controlClass} font-mono tabular-nums`}
        />
      </Field>
      <Field label={t("boats.workingChannelLabel")} description={t("boats.workingChannelHint")}>
        <input
          name="workingChannel"
          type="text"
          maxLength={MAX_WORKING_CHANNEL_LENGTH}
          autoComplete="off"
          spellCheck={false}
          defaultValue={boat?.workingChannel ?? ""}
          aria-invalid={radioInvalid || channelInvalid || undefined}
          aria-describedby={radioInvalid || channelInvalid ? describedBy : undefined}
          className={`${controlClass} font-mono tabular-nums`}
        />
      </Field>
    </div>
  );
}

/**
 * What the row's own numbers say: total occupants over the total-person limit,
 * and a paper inside its last 30 days or past them.
 * Nothing renders for a boat in order.
 *
 * A total-person mismatch prevents a contradictory boat setup; the passenger
 * certificate remains a separate limit on upcoming trip bookings. The papers
 * still only inform, and a lapsed one reads in danger ink, as on the manifest
 * and Today (H-136).
 */
const PAPER_INK = {
  danger: "font-medium text-danger",
  warning: "font-medium text-warning-strong",
  neutral: "text-muted",
} as const;

export function BoatPaperFacts({
  boat,
  t,
  todayLocal,
  locale,
}: {
  boat: Boat;
  t: StaffTranslator;
  todayLocal: string;
  locale: string;
}) {
  const papers = boatPaperNotices(boat, todayLocal);
  const overTotalPersons = boatCapacityAboveTotalPersons(boat.capacity, boat.certifiedTotalPersons);
  if (papers.length === 0 && !overTotalPersons) return null;
  return (
    <ul className="w-full space-y-1 text-base sm:basis-full">
      {overTotalPersons ? (
        <li className="font-medium text-danger">
          {t("boats.capacityAboveTotalPersons", {
            capacity: boat.capacity,
            limit: boat.certifiedTotalPersons ?? 0,
          })}
        </li>
      ) : null}
      {papers.map((notice) => (
        <li
          key={notice.code === "paper" ? notice.paper : notice.code}
          className={PAPER_INK[boatSafetyNoticeTone(notice)]}
        >
          {boatSafetyNoticeText(t, locale, notice)}
        </li>
      ))}
    </ul>
  );
}
