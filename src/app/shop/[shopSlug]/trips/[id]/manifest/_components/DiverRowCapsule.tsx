import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { staffParticipantTypeLabel, staffSeatTypeNote } from "@/i18n/participant-labels";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import type { DiverRowState } from "./diver-row-state";

/**
 * **The row's one capsule**, drawn for the exception `diverRowState` chose —
 * or nothing. A function rather than a component because the row asks
 * whether there *is* one before it draws the line that holds it.
 */
export function diverCapsule(
  diver: TripManifest["divers"][number],
  {
    splitAfterDive,
    alarmed,
    blockedAtDock,
    diverStatus,
    earlierRefusal,
    referralUnresolved,
  }: DiverRowState,
  t: StaffTranslator,
): ReactNode {
  const buddyCapsule =
    diver.buddyAlert && diver.buddyTeam ? (
      <Badge tone={splitAfterDive ? "danger" : "warning"}>
        {buddyAlertText(t, diver.buddyAlert)}
      </Badge>
    ) : null;
  const capsule =
    splitAfterDive && buddyCapsule ? (
      buddyCapsule
    ) : alarmed ? null : blockedAtDock ? (
      <Badge tone={readinessStatusTone(diverStatus)}>{readinessStatusText(t, diverStatus)}</Badge>
    ) : buddyCapsule ? (
      buddyCapsule
    ) : earlierRefusal ? (
      <Badge tone="warning">{t("manifest.medicalEarlierRefusalChip")}</Badge>
    ) : referralUnresolved ? (
      <Badge tone="warning">{t("manifest.medicalReferralUnresolvedChip")}</Badge>
    ) : diver.minor && diver.age !== null && diver.age !== undefined ? (
      <Badge tone="warning" tabularNums>
        {t("manifest.minorAge", { age: diver.age })}
      </Badge>
    ) : diver.depthAdvisory?.status === "exceeds" ? (
      <Badge tone="warning">{t("manifest.depthChip")}</Badge>
    ) : diver.birthday ? (
      <Badge tone="primary">{birthdayCalloutText(t, diver.birthday)}</Badge>
    ) : null;
  return capsule;
}

/** The seat's type in words, beside the capsule — or nothing for a diver. */
export function diverTypeBadge(
  diver: TripManifest["divers"][number],
  t: StaffTranslator,
): ReactNode {
  // **Snorkeler or rider, in words** (ADR 20261007-participant-types).
  // Neutral and outside the one-capsule chain, like the not-here pill:
  // it is not an exception to act on, it is who this body is.
  const seatNote = staffSeatTypeNote(t, diver);
  const typeBadge = seatNote ? (
    <Badge tone="warning">{seatNote}</Badge>
  ) : diver.participantType && diver.participantType !== "diver" ? (
    <Badge tone="neutral">{staffParticipantTypeLabel(t, diver.participantType)}</Badge>
  ) : null;
  return typeBadge;
}
