import { ALL_ROLES, type Role } from "@/lib/authz";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **A person's roles, in the words the Team page gave them** — one map, because
 * there were three.
 *
 * The staffing roster, the departure log and the Team page each carried their
 * own copy of this record, and the boat manifest carried none at all: it
 * rendered `member.roles.join(", ")` straight out of `effectiveCrewRoles`, so
 * the roll-call sheet that goes ashore said "divemaster" rather than
 * "Divemaster", in English, to a Spanish reader. That was survivable while
 * every code happened to be one lowercase word. `assistant_instructor` is the
 * first that reads as a database value, and it arrives on exactly the surface
 * where a new hire most often has no per-trip job set (issue #1680,
 * dive-domain review).
 *
 * Exhaustive over `Role` by type, so a rung added to the union without its word
 * is a compile error rather than an underscore on a safety document.
 */
export const STAFF_ROLE_LABEL_KEYS: Record<Role, StaffMessageKey> = {
  owner: "settings.team.roleLabels.owner",
  manager: "settings.team.roleLabels.manager",
  instructor: "settings.team.roleLabels.instructor",
  assistant_instructor: "settings.team.roleLabels.assistant_instructor",
  divemaster: "settings.team.roleLabels.divemaster",
  captain: "settings.team.roleLabels.captain",
  crew: "settings.team.roleLabels.crew",
  diver: "settings.team.roleLabels.diver",
};

/** Is this string one of the roles a person can hold? */
export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/**
 * The word for one role code, for the callers that hold *strings* rather than
 * `Role` — `effectiveCrewRoles` hands back whatever the roster recorded, and a
 * per-trip job and a standing role are both in there.
 *
 * An unrecognised code renders as itself. It cannot happen through the schema,
 * and a crew member whose role silently vanished off a roll-call sheet would be
 * worse than one whose role reads oddly.
 */
export function staffRoleLabel(t: StaffTranslator, role: string): string {
  return isRole(role) ? t(STAFF_ROLE_LABEL_KEYS[role]) : role;
}

/**
 * Every role, in the reader's own words, keyed by code — for the Team page's
 * checkbox list, which needs the whole vocabulary rather than one person's
 * slice of it.
 */
export function staffRoleLabelRecord(t: StaffTranslator): Record<Role, string> {
  const labels = {} as Record<Role, string>;
  for (const role of ALL_ROLES) labels[role] = t(STAFF_ROLE_LABEL_KEYS[role]);
  return labels;
}

/** Every role a person holds, in the reader's own words, ready to join. */
export function staffRoleLabels(t: StaffTranslator, roles: readonly string[]): string[] {
  return roles.map((role) => staffRoleLabel(t, role));
}
