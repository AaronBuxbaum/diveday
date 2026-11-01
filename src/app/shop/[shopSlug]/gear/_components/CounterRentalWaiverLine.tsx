import Link from "next/link";
import type { ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { waiverRowStateText, waiverRowStateTone } from "@/i18n/waiver-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { counterRentalWaiverFlag } from "@/lib/counter-rentals";
import { shopPath } from "@/lib/staff-notices";
import { medicalWarningDays, type ShopWaiverStatus } from "@/lib/waivers";
import { WaiverSendControl } from "../../_components/today/WaiverSendControl";

/**
 * **The person's waiver, informing only** (issue #2261, H-20261008-counter-rental-waiver-informs): a counter
 * rental never waits on it, so this is a line and a way to send the link,
 * never a gate. One component for the two places a counter says it: the
 * rental ticket, and the new-rental form while the person is still at the
 * counter choosing gear (issue #2346).
 *
 * - **Not signed, lapsed, or a minor alone**: "Waiver: <standing>" and the
 *   link to send, a `counter` send, so the held send refreshes the page the
 *   staffer is on and is counted as a counter send.
 * - **A medical hold or a physician's "not cleared"**: the readiness
 *   sentence in full, with no link, since another link fixes nothing.
 * - **Current, standing over a physician's earlier "not cleared" or an open
 *   referral** (H-20261007-after-physician-says-no as amended, issues #2158, #2195): the manifest's warning
 *   and a link to the record, as the diver record, the roster and the live
 *   manifest say it.
 * - **Current and clean, or not read**: nothing.
 */
export function CounterRentalWaiverLine({
  t,
  status,
  personId,
  ticketId,
  shopSlug,
  locale,
  timezone,
  className = "",
}: {
  t: StaffTranslator;
  status: ShopWaiverStatus | undefined;
  personId: string;
  /** The rental's ticket, once there is one; absent on the new-rental form. */
  ticketId?: string;
  shopSlug: string;
  locale: string;
  timezone: string;
  className?: string;
}) {
  if (!status) return null;
  const sectionClass = `flex flex-wrap items-center justify-between gap-3 ${className}`.trim();

  if (status.state === "current") {
    const medical = status.medical;
    const refusal = medical?.overriddenRefusal ?? null;
    const referralAt = medical?.overriddenReferralAt ?? null;
    if (!refusal && !referralAt) return null;
    const days = medicalWarningDays(medical, timezone);
    const referral = medical?.overriddenReferral ?? null;
    const recordHref = (recordId: string) =>
      shopPath(shopSlug, "divers", personId, "waivers", recordId);
    return (
      <section className={sectionClass}>
        <p className="flex flex-col gap-1 font-medium text-warning-strong">
          {refusal ? (
            <WarningLine>
              {t("manifest.medicalEarlierRefusal", {
                date: formatCalendarDate(days.refusedOn ?? "", locale),
              })}{" "}
              <Link
                href={recordHref(refusal.recordId)}
                className="font-semibold text-primary hover:underline"
              >
                {t("trips.roster.viewPhysicianDecision")}
              </Link>
            </WarningLine>
          ) : null}
          {referralAt ? (
            <WarningLine>
              {t("manifest.medicalReferralUnresolved", {
                date: formatCalendarDate(days.referredOn ?? "", locale),
              })}
              {referral ? (
                <>
                  {" "}
                  <Link
                    href={recordHref(referral.recordId)}
                    className="font-semibold text-primary hover:underline"
                  >
                    {t("manifest.medicalReferralLink")}
                  </Link>
                </>
              ) : null}
            </WarningLine>
          ) : null}
        </p>
      </section>
    );
  }

  const flag = counterRentalWaiverFlag(status.state);
  if (!flag) return null;
  // The two medical states say the readiness sentence whole: "Waiver:" in
  // front of a physician's answer would misname it.
  const text =
    status.state === "medical_not_cleared"
      ? t("shared.readiness.blockers.medicalNotCleared")
      : status.state === "medical_review"
        ? t("shared.readiness.blockers.medicalReview")
        : t("gearRentals.waiver", { standing: waiverRowStateText(t, status.state) });
  return (
    <section className={sectionClass}>
      <p
        className={`font-medium ${
          waiverRowStateTone(status.state) === "danger" ? "text-danger" : "text-warning-strong"
        }`}
      >
        <WarningLine>{text}</WarningLine>
      </p>
      {flag.offerLink ? (
        <WaiverSendControl
          surface="counter"
          ticketId={ticketId}
          personId={personId}
          bookingIds={[]}
          label={t("gearRentals.sendWaiver")}
          copy={waiverSendCopy(t)}
        />
      ) : null}
    </section>
  );
}

function WarningLine({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="flex h-lh shrink-0 items-center self-start">
        <DiveDayIcon name="warning" className="size-4 shrink-0" />
      </span>
      <span>{children}</span>
    </span>
  );
}
