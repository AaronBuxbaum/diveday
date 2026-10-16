import { controlClass, DateField, Field } from "@/components/ui/form";
import type { Boat } from "@/db/boats";
import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  boatPaperNotices,
  boatSafetyNoticeTone,
  passengersAboveCertificate,
} from "@/lib/boat-safety";
import { MAX_CALL_SIGN_LENGTH } from "@/lib/emergency-reference";

/**
 * **The certificate and the three paper dates** (roadmap N-10), under the
 * boat's own line. Captioned, because a date box with only a placeholder says
 * nothing once it holds a date. All four optional: an empty box is a boat the
 * shop has not dated, and nothing reads it as expired.
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
  describedBy,
}: {
  boat?: Boat;
  t: StaffTranslator;
  className?: string;
  /** The row's certificate error (H-107): the limit box is half of it. */
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      className={`grid w-full grid-cols-1 gap-3 sm:basis-full sm:grid-cols-2 ${className}`.trim()}
    >
      <Field
        label={t("boats.certifiedPassengersLabel")}
        description={t("boats.certifiedPassengersHint")}
      >
        <input
          name="certifiedPassengers"
          type="number"
          min={1}
          max={999}
          inputMode="numeric"
          defaultValue={boat?.certifiedPassengers ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${controlClass} tabular-nums`}
        />
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
          className={`${controlClass} font-mono tabular-nums`}
        />
      </Field>
    </div>
  );
}

/**
 * What the row's own numbers say, in the pre-departure check's words: seats on
 * sale past the certificate, and a paper inside its last 30 days or past them.
 * Nothing renders for a boat in order.
 *
 * **Seats past the certificate is danger now** (H-107): a hull saved before the
 * decision keeps sailing, but its next save is refused until the seats come
 * down or the certificate is corrected, and the row says so before the shop
 * finds out by pressing Save. The papers still only inform, and a lapsed one
 * reads in danger ink, as on the manifest and Today (H-136).
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
  const overSold = passengersAboveCertificate(boat.capacity, boat.certifiedPassengers);
  if (papers.length === 0 && !overSold) return null;
  return (
    <ul className="w-full space-y-1 text-sm sm:basis-full">
      {overSold ? (
        <li className="font-medium text-danger">
          {t("boats.seatsAboveCertificate", {
            capacity: boat.capacity,
            limit: boat.certifiedPassengers ?? 0,
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
