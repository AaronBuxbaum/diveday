import Link from "next/link";
import type { ReactNode } from "react";
import { drysuitCardWarningText } from "@/i18n/rental-labels";
import { formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import type { RowHeader } from "./roster-row-header";
import type { RowNotices } from "./roster-row-notices";
import type { RosterSeat } from "./roster-seat";

/** Every reason line the seat can carry, keyed, in the order the row says them. */
export function rowReasonLines(seat: RosterSeat & RowHeader & RowNotices) {
  const {
    person,
    t,
    shopSlug,
    shopTimezone,
    locale,
    requiresPayment,
    paymentStatus,
    waiverControl,
    showsPersonDetail,
    hasEmergencyContact,
    blockerTexts,
    depthText,
    depthShared,
    drysuitCard,
    recencyText,
    linkAction,
    medicalActions,
    earlierRefusal,
    earlierReferral,
    moreHoldsBehindConfirmation,
  } = seat;
  const reasonLines: {
    key: string;
    text: string;
    tone: "danger" | "warning";
    actions?: ReactNode;
  }[] = [
    ...blockerTexts.map(({ blocker, text }) => ({
      key: text,
      text,
      tone: "danger" as const,
      actions:
        blocker.code === "medical_review" || blocker.code === "medical_not_cleared"
          ? medicalActions
          : undefined,
    })),
    ...(earlierRefusal
      ? [
          {
            key: "earlier-refusal",
            text: t("trips.roster.earlierRefusal", {
              date: formatShortDate(earlierRefusal.at, locale, shopTimezone),
            }),
            tone: "warning" as const,
            actions: (
              <Link
                href={shopPath(shopSlug, "divers", person.id, "waivers", earlierRefusal.recordId)}
                className={linkAction}
              >
                {t("trips.roster.viewSignedRecord")}
              </Link>
            ),
          },
        ]
      : []),
    ...(earlierReferral
      ? [
          {
            key: "earlier-referral",
            text: t("trips.roster.referralUnresolved", {
              date: formatShortDate(earlierReferral.at, locale, shopTimezone),
            }),
            tone: "warning" as const,
            actions: (
              <Link
                href={shopPath(shopSlug, "divers", person.id, "waivers", earlierReferral.recordId)}
                className={linkAction}
              >
                {t("trips.roster.viewReferral")}
              </Link>
            ),
          },
        ]
      : []),
    ...(moreHoldsBehindConfirmation
      ? [
          {
            key: "more-holds",
            text: t("trips.roster.heldSeatMoreHolds"),
            tone: "danger" as const,
          },
        ]
      : []),
    ...(depthText !== null && !depthShared
      ? [{ key: "depth", text: depthText, tone: "warning" as const }]
      : []),
    ...(drysuitCard.status !== "ok"
      ? [
          {
            key: "drysuit",
            text: drysuitCardWarningText(t, drysuitCard),
            tone: "warning" as const,
          },
        ]
      : []),
    ...(recencyText !== null
      ? [{ key: "recency", text: recencyText, tone: "warning" as const }]
      : []),
    // A seat whose readiness is clear can still be filed under "Still to
    // clear" by its paperwork or its money, and a row in that group with no
    // stated reason trains a crew to stop reading the group (dive-domain
    // review 2026-10-05). A waiver blocker already says the first; this is
    // for the seat no blocker speaks for. Not on a held seat: the waiver
    // read is the matched person's, so its state is theirs to state.
    ...(waiverControl.action !== null && blockerTexts.length === 0 && showsPersonDetail
      ? [
          {
            key: "waiver",
            text: t("trips.roster.reasonWaiverNotSigned"),
            tone: "warning" as const,
          },
        ]
      : []),
    ...(requiresPayment &&
    paymentStatus !== "paid" &&
    paymentStatus !== "waived" &&
    paymentStatus !== "partly_refunded"
      ? [{ key: "payment", text: t("trips.roster.reasonUnpaid"), tone: "warning" as const }]
      : []),
    // Withheld on an unconfirmed row in both directions: the contact is the
    // matched person's own record (`showsPersonDetail`).
    ...(!hasEmergencyContact && showsPersonDetail
      ? [
          {
            key: "contact",
            text: `${t("trips.roster.emergencyContactHeading")} · ${t("trips.roster.emergencyContactMissing")}`,
            tone: "warning" as const,
          },
        ]
      : []),
  ];
  // Each line's mark is its first column, one line of the words tall, so it
  // centres on their first line whatever wraps below it (K-494).
  /**
   * **The matched record's contact stands beside the question** (Aaron,
   * 2026-10-06: "needs to show some information so you know what you're
   * comparing … show the contact info still so you can contact them and
   * ask"). The reason line names the two people; these are the two ways to
   * ask the person on file. Only the record's email and phone come out from
   * behind the flag: the diver record prints both in its header to every
   * staffer anyway, and for a shared-inbox match the email is the one the
   * booker typed. Medical answers, date of birth, emergency contact and
   * sizes still wait for "Same person" (security review 2026-09-11).
   *
   * While arrivals are open the screen faces the queue, so the line moves
   * behind the row's mark with the desk's other private lines rather than
   * printing a stranger's email and phone to whoever is next in line.
   */
  return { reasonLines };
}

export type RowReasonLines = ReturnType<typeof rowReasonLines>;
