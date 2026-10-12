import type { Role } from "@/lib/authz";

/**
 * **An incident report's rules, without a database** (ADR
 * 20261012-incident-reports): who may do what to one, what filing needs, and
 * how a draft's fields are read from a form.
 *
 * A report is a record, never a gate. Nothing here is read by readiness, roll
 * call, booking or the close-out, and nothing here refuses a diver anything.
 */

export const INCIDENT_HANDOVER_KINDS = ["ems", "hospital", "chamber", "diver", "other"] as const;
export type IncidentHandoverKind = (typeof INCIDENT_HANDOVER_KINDS)[number];

export const INCIDENT_INVOLVEMENTS = ["affected", "witness", "responder"] as const;
export type IncidentInvolvement = (typeof INCIDENT_INVOLVEMENTS)[number];

export type IncidentReportStatus = "draft" | "filed";

/** The longest free text a field takes. A report is read on paper; a page is plenty. */
export const INCIDENT_TEXT_MAX = 5000;
/** A name or a place. */
export const INCIDENT_SHORT_TEXT_MAX = 200;
/** A day of oxygen is the ceiling the database holds too (`incident_reports_oxygen_minutes`). */
export const INCIDENT_OXYGEN_MINUTES_MAX = 1440;

/** Owners and managers read every report in the shop. */
export function canReadEveryIncidentReport(roles: readonly Role[] | null | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager");
}

export type IncidentViewer = {
  personId: string;
  /** Live roles, or null when the person is not active staff of this shop. */
  roles: readonly Role[] | null;
  /** Whether the viewer is on this departure's crew list. */
  onCrew: boolean;
};

/** Who may start a report on a departure: its crew, and owners and managers. */
export function mayStartIncidentReport(viewer: IncidentViewer): boolean {
  if (viewer.roles === null) return false;
  return viewer.onCrew || canReadEveryIncidentReport(viewer.roles);
}

/** Who may read one report: owners and managers, and whoever started it. */
export function mayReadIncidentReport(
  viewer: IncidentViewer,
  report: { createdByPersonId: string },
): boolean {
  if (viewer.roles === null) return false;
  return canReadEveryIncidentReport(viewer.roles) || report.createdByPersonId === viewer.personId;
}

/**
 * Who may change a draft, file it, or add an addendum to a filed one: the same
 * people who may read it. A filed report itself never changes.
 */
export function mayWriteIncidentReport(
  viewer: IncidentViewer,
  report: { createdByPersonId: string },
): boolean {
  return mayReadIncidentReport(viewer, report);
}

/** The fields a draft holds, as the database stores them. */
export type IncidentDraftFields = {
  occurredAt: Date | null;
  diveSiteId: string | null;
  locationText: string | null;
  whatHappened: string | null;
  firstAidGiven: boolean | null;
  oxygenGiven: boolean | null;
  oxygenMinutes: number | null;
  emergencyServicesCalled: boolean | null;
  handoverKind: IncidentHandoverKind | null;
  handoverDetail: string | null;
  handedOverAt: Date | null;
  followUp: string | null;
};

/** What filing still needs, as codes. Empty means the report can be filed. */
export type IncidentFilingGap =
  | "occurred_at"
  | "what_happened"
  | "first_aid"
  | "oxygen"
  | "emergency_services";

export function incidentFilingGaps(fields: IncidentDraftFields): IncidentFilingGap[] {
  const gaps: IncidentFilingGap[] = [];
  if (fields.occurredAt === null) gaps.push("occurred_at");
  if (!fields.whatHappened?.trim()) gaps.push("what_happened");
  if (fields.firstAidGiven === null) gaps.push("first_aid");
  if (fields.oxygenGiven === null) gaps.push("oxygen");
  if (fields.emergencyServicesCalled === null) gaps.push("emergency_services");
  return gaps;
}

/** Why a draft's fields were refused, as codes. */
export type IncidentFieldRefusal =
  | "occurred_at_invalid"
  | "handed_over_at_invalid"
  | "handed_over_before_incident"
  | "oxygen_minutes_invalid"
  | "text_too_long";

type FormValue = string | null | undefined;

/** A trimmed string, or null when blank. */
function text(value: FormValue): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `yes` / `no` from a radio pair; anything else is unanswered. */
export function yesNo(value: FormValue): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function isHandoverKind(value: string): value is IncidentHandoverKind {
  return (INCIDENT_HANDOVER_KINDS as readonly string[]).includes(value);
}

export function isIncidentInvolvement(value: unknown): value is IncidentInvolvement {
  return (INCIDENT_INVOLVEMENTS as readonly unknown[]).includes(value);
}

/**
 * A draft's fields from a submitted form. Times arrive as wall-clock values in
 * the shop's zone and are turned into instants by `toInstant`, which the caller
 * supplies so this module never reads a zone database of its own.
 *
 * A blank time is unanswered, not an error. A time that cannot be read is
 * refused rather than dropped, so a staffer never files a report believing a
 * time was kept that was not.
 */
export function parseIncidentDraft(
  form: {
    occurredOn: FormValue;
    occurredTime: FormValue;
    diveSiteId: FormValue;
    locationText: FormValue;
    whatHappened: FormValue;
    firstAidGiven: FormValue;
    oxygenGiven: FormValue;
    oxygenMinutes: FormValue;
    emergencyServicesCalled: FormValue;
    handoverKind: FormValue;
    handoverDetail: FormValue;
    handedOverOn: FormValue;
    handedOverTime: FormValue;
    followUp: FormValue;
  },
  toInstant: (date: string, time: string) => Date | null,
): { ok: true; fields: IncidentDraftFields } | { ok: false; reason: IncidentFieldRefusal } {
  const instant = (date: FormValue, time: FormValue): Date | null | "invalid" => {
    const day = text(date);
    const hour = text(time);
    if (!day && !hour) return null;
    if (!day || !hour) return "invalid";
    return toInstant(day, hour) ?? "invalid";
  };
  const occurredAt = instant(form.occurredOn, form.occurredTime);
  if (occurredAt === "invalid") return { ok: false, reason: "occurred_at_invalid" };
  const handedOverAt = instant(form.handedOverOn, form.handedOverTime);
  if (handedOverAt === "invalid") return { ok: false, reason: "handed_over_at_invalid" };
  if (occurredAt && handedOverAt && handedOverAt.getTime() < occurredAt.getTime()) {
    return { ok: false, reason: "handed_over_before_incident" };
  }

  const oxygenGiven = yesNo(form.oxygenGiven);
  const minutesText = text(form.oxygenMinutes);
  let oxygenMinutes: number | null = null;
  if (minutesText !== null && oxygenGiven === true) {
    if (!/^\d{1,4}$/.test(minutesText)) return { ok: false, reason: "oxygen_minutes_invalid" };
    oxygenMinutes = Number(minutesText);
    if (oxygenMinutes > INCIDENT_OXYGEN_MINUTES_MAX) {
      return { ok: false, reason: "oxygen_minutes_invalid" };
    }
  }

  const fields: IncidentDraftFields = {
    occurredAt,
    diveSiteId: text(form.diveSiteId),
    locationText: text(form.locationText),
    whatHappened: text(form.whatHappened),
    firstAidGiven: yesNo(form.firstAidGiven),
    oxygenGiven,
    oxygenMinutes,
    emergencyServicesCalled: yesNo(form.emergencyServicesCalled),
    handoverKind: (() => {
      const kind = text(form.handoverKind);
      return kind && isHandoverKind(kind) ? kind : null;
    })(),
    handoverDetail: text(form.handoverDetail),
    handedOverAt,
    followUp: text(form.followUp),
  };
  const long = [fields.whatHappened, fields.followUp].some(
    (value) => (value?.length ?? 0) > INCIDENT_TEXT_MAX,
  );
  const longShort = [fields.locationText, fields.handoverDetail].some(
    (value) => (value?.length ?? 0) > INCIDENT_SHORT_TEXT_MAX,
  );
  if (long || longShort) return { ok: false, reason: "text_too_long" };
  return { ok: true, fields };
}
