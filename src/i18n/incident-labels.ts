import type { IncidentKind, IncidentSeverity } from "@/lib/incident-reports";
import type { StaffMessageKey } from "./staff-messages";

/**
 * **An incident report's kind and severity, in words** (batch 6, item 7; ADR
 * 20261012-incident-reports, amendment 2026-10-14). Read by the report itself
 * and by the Safety tab's list, so the two never name one code differently.
 */
export const INCIDENT_KIND_KEYS: Record<IncidentKind, StaffMessageKey> = {
  injury: "incidents.kind.injury",
  near_miss: "incidents.kind.near_miss",
  equipment: "incidents.kind.equipment",
  missing_diver: "incidents.kind.missing_diver",
  other: "incidents.kind.other",
};

export const INCIDENT_SEVERITY_KEYS: Record<IncidentSeverity, StaffMessageKey> = {
  minor: "incidents.severity.minor",
  moderate: "incidents.severity.moderate",
  serious: "incidents.severity.serious",
};
