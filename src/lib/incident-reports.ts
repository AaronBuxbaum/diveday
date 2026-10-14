import { canReadEveryIncidentReport, isStaff, type Role } from "@/lib/authz";

/**
 * **An incident report's rules, without a database** (ADR
 * 20261012-incident-reports): who may do what to one, what filing needs, and
 * how a draft's fields are read from a form.
 *
 * A report is a record, never a gate. Nothing here is read by readiness, roll
 * call, booking or the close-out, and nothing here refuses a diver anything.
 */

/**
 * Who took over care. `none` is an answer — the person stayed with the crew —
 * and is distinct from a handover nobody has written down yet (null).
 */
export const INCIDENT_HANDOVER_KINDS = [
  "none",
  "ems",
  "hospital",
  "chamber",
  "diver",
  "other",
] as const;
export type IncidentHandoverKind = (typeof INCIDENT_HANDOVER_KINDS)[number];

/**
 * What kind of incident it was (batch 6, item 7). Keep aligned with the
 * `incident_kind` pg enum. `missing_diver` is its own kind, apart from injury,
 * and so is `fatality`: an insurer, a coastguard and a training agency each
 * ask for a death first, and "injury, serious" does not say it (dive-domain
 * review 20261014). `injury` covers illness too (DCS, a seasick faint).
 */
export const INCIDENT_KINDS = [
  "injury",
  "near_miss",
  "equipment",
  "missing_diver",
  "fatality",
  "other",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/**
 * How serious it was, in the crew's own judgement on the day: three words,
 * never a clinical scale. Keep aligned with the `incident_severity` pg enum.
 */
export const INCIDENT_SEVERITIES = ["minor", "moderate", "serious"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_INVOLVEMENTS = ["affected", "witness", "responder"] as const;
export type IncidentInvolvement = (typeof INCIDENT_INVOLVEMENTS)[number];

export type IncidentReportStatus = "draft" | "filed";

/** The longest free text a field takes. A report is read on paper; a page is plenty. */
export const INCIDENT_TEXT_MAX = 5000;
/** A name or a place. */
export const INCIDENT_SHORT_TEXT_MAX = 200;
/** A day of oxygen is the ceiling the database holds too (`incident_reports_oxygen_minutes`). */
export const INCIDENT_OXYGEN_MINUTES_MAX = 1440;

export type IncidentViewer = {
  personId: string;
  /** Live roles, or null when the person is not active staff of this shop. */
  roles: readonly Role[] | null;
  /** Whether the viewer is on this departure's crew list. */
  onCrew: boolean;
};

/** Who may start a report on a departure: its crew, and owners and managers. */
export function mayStartIncidentReport(viewer: IncidentViewer): boolean {
  if (viewer.roles === null || !isStaff(viewer.roles)) return false;
  return viewer.onCrew || canReadEveryIncidentReport(viewer.roles);
}

/** Who may read one report: owners and managers, and whoever started it. */
export function mayReadIncidentReport(
  viewer: IncidentViewer,
  report: { createdByPersonId: string },
): boolean {
  if (viewer.roles === null || !isStaff(viewer.roles)) return false;
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
  kind: IncidentKind | null;
  severity: IncidentSeverity | null;
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
  | "location"
  | "what_happened"
  | "kind"
  | "severity"
  | "first_aid"
  | "oxygen"
  | "emergency_services"
  | "handover";

export function incidentFilingGaps(fields: IncidentDraftFields): IncidentFilingGap[] {
  const gaps: IncidentFilingGap[] = [];
  if (fields.occurredAt === null) gaps.push("occurred_at");
  if (fields.diveSiteId === null && !fields.locationText?.trim()) gaps.push("location");
  if (!fields.whatHappened?.trim()) gaps.push("what_happened");
  if (fields.kind === null) gaps.push("kind");
  if (fields.severity === null) gaps.push("severity");
  if (fields.firstAidGiven === null) gaps.push("first_aid");
  if (fields.oxygenGiven === null) gaps.push("oxygen");
  if (fields.emergencyServicesCalled === null) gaps.push("emergency_services");
  // Once a medic or oxygen was involved, where the person went is part of the account.
  const careEscalated = fields.emergencyServicesCalled === true || fields.oxygenGiven === true;
  if (careEscalated && fields.handoverKind === null) gaps.push("handover");
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

/** A code from a fixed list, or null for anything else, blank included. */
function oneOf<T extends string>(list: readonly T[], value: FormValue): T | null {
  const code = text(value);
  return code !== null && (list as readonly string[]).includes(code) ? (code as T) : null;
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
    kind: FormValue;
    severity: FormValue;
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
    // Zero minutes contradicts "yes": refused rather than stored.
    if (oxygenMinutes < 1 || oxygenMinutes > INCIDENT_OXYGEN_MINUTES_MAX) {
      return { ok: false, reason: "oxygen_minutes_invalid" };
    }
  }

  const fields: IncidentDraftFields = {
    occurredAt,
    diveSiteId: text(form.diveSiteId),
    locationText: text(form.locationText),
    whatHappened: text(form.whatHappened),
    kind: oneOf(INCIDENT_KINDS, form.kind),
    severity: oneOf(INCIDENT_SEVERITIES, form.severity),
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
