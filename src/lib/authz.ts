/**
 * Role vocabulary and staff gating. Keep the Role union aligned with the
 * person_role pg enum in src/db/schema.ts. Route-level gating happens in
 * src/proxy.ts (outer wall); server code re-checks with requireStaffSession()
 * — the proxy is never the only layer (ADR-0006).
 */

export const ALL_ROLES = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
  "customer",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export const STAFF_ROLES: readonly Role[] = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
];

export function isStaff(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => STAFF_ROLES.includes(role));
}
