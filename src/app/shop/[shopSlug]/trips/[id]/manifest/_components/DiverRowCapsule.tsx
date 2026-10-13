import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { medicalWarningChips } from "@/i18n/manifest-labels";
import { staffParticipantTypeLabel, staffSeatTypeNote } from "@/i18n/participant-labels";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import type { DiverRowState } from "./diver-row-state";

/**
 * **The row's one capsule**, drawn from the kind `diverRowState` chose —
 * or nothing (issue #2307: one chain decides it, so screen and paper
 * agree). A function rather than a component because the row asks whether
 * there *is* one before it draws the line that holds it.
 */
export function diverCapsule(
  diver: TripManifest["divers"][number],
  { splitAfterDive, diverStatus, capsuleKind, medicalDays }: DiverRowState,
  t: StaffTranslator,
): ReactNode {
  return capsuleKind === "buddy" && diver.buddyAlert ? (
    <Badge tone={splitAfterDive ? "danger" : "warning"}>
      {buddyAlertText(t, diver.buddyAlert)}
    </Badge>
  ) : capsuleKind === "blocked" ? (
    <Badge tone={readinessStatusTone(diverStatus)}>{readinessStatusText(t, diverStatus)}</Badge>
  ) : capsuleKind === "medical" ? (
    <Badge tone="warning">{medicalWarningChips(t, medicalDays)[0]}</Badge>
  ) : capsuleKind === "minor" ? (
    <Badge tone="warning" tabularNums>
      {t("manifest.minorAge", { age: diver.age ?? 0 })}
    </Badge>
  ) : capsuleKind === "depth" ? (
    <Badge tone="warning">{t("manifest.depthChip")}</Badge>
  ) : capsuleKind === "birthday" && diver.birthday ? (
    <Badge tone="primary">{birthdayCalloutText(t, diver.birthday)}</Badge>
  ) : null;
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
