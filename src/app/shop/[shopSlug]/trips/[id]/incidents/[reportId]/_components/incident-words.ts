import type { StaffMessageKey } from "@/i18n/staff-messages";
import type {
  IncidentFilingGap,
  IncidentHandoverKind,
  IncidentInvolvement,
} from "@/lib/incident-reports";

/** The words for each code an incident report stores, in the staff bundle. */
export const HANDOVER_KIND_KEYS: Record<IncidentHandoverKind, StaffMessageKey> = {
  none: "incidents.handoverKind.none",
  ems: "incidents.handoverKind.ems",
  hospital: "incidents.handoverKind.hospital",
  chamber: "incidents.handoverKind.chamber",
  diver: "incidents.handoverKind.diver",
  other: "incidents.handoverKind.other",
};

export const INVOLVEMENT_KEYS: Record<IncidentInvolvement, StaffMessageKey> = {
  affected: "incidents.involvement.affected",
  witness: "incidents.involvement.witness",
  responder: "incidents.involvement.responder",
};

export const PERSON_KIND_KEYS: Record<"booking" | "staff" | "outsider", StaffMessageKey> = {
  booking: "incidents.people.kindBooking",
  staff: "incidents.people.kindStaff",
  outsider: "incidents.people.kindOutsider",
};

export const FILING_GAP_KEYS: Record<IncidentFilingGap, StaffMessageKey> = {
  occurred_at: "incidents.file.gap.occurred_at",
  location: "incidents.file.gap.location",
  what_happened: "incidents.file.gap.what_happened",
  kind: "incidents.file.gap.kind",
  severity: "incidents.file.gap.severity",
  first_aid: "incidents.file.gap.first_aid",
  oxygen: "incidents.file.gap.oxygen",
  emergency_services: "incidents.file.gap.emergency_services",
  handover: "incidents.file.gap.handover",
};
