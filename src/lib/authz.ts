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
  "diver",
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

/**
 * The full-shop export hands over more than any staff surface shows — every
 * diver's contact details plus complete signed medical answers — so it is the
 * one staff feature gated past `isStaff`, to the accountable roles
 * (ADR 20260722-full-shop-export).
 */
export function canExportShopData(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager");
}

/**
 * Bulk contact import writes to the roster and carries the whole file's people,
 * cards, and sizes at once — the same accountability weight as the export, so
 * it takes the same owner/manager gate (ADR 20260723-contact-importer).
 */
export function canImportShopData(roles: readonly Role[] | undefined): boolean {
  return canExportShopData(roles);
}

/**
 * Owner reporting is the buyer's "how's my month" — revenue, fill rate, waiver
 * completion across the whole shop. Revenue is owner-grade information the daily
 * crew has no reason to see, so it takes the same accountable owner/manager gate
 * as export and import (ADR 20260723-owner-reporting).
 */
export function canViewShopReports(roles: readonly Role[] | undefined): boolean {
  return canExportShopData(roles);
}
