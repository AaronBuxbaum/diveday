import type { Role } from "@/lib/authz";
import {
  type StaffDestinationId,
  staffDestination,
  staffDestinationHref,
  staffShopRoot,
} from "@/lib/staff-destinations";
import type { StaffTranslator } from "./staff-messages";

/** The staff roles Today's first-visit orientation card has its own content for. */
export type OrientationRole =
  | "owner"
  | "manager"
  | "instructor"
  | "divemaster"
  | "captain"
  | "crew";

/**
 * Precedence when a person holds more than one staff role — the same order
 * `shop/[shopSlug]/layout.tsx` uses for the demo role switcher's "current
 * role" pill, so a person who is both an instructor and a divemaster sees a
 * consistent "who am I" answer across the demo banner and this card.
 */
const ROLE_PRECEDENCE: readonly OrientationRole[] = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
];

/** The highest-precedence orientation role this person holds, or null for a diver-only session. */
export function orientationRoleFor(roles: readonly Role[]): OrientationRole | null {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? null;
}

export type OrientationTourCopy = {
  title: string;
  desc: string;
  tryThis: string;
};

/** Role-specific "Try:" tour content — the real-shop counterpart of the demo role tour (`DemoBanner`). */
export function orientationTourText(
  t: StaffTranslator,
  role: OrientationRole,
): OrientationTourCopy {
  return {
    title: t(`shopHome.orientation.roles.${role}.title`),
    desc: t(`shopHome.orientation.roles.${role}.desc`),
    tryThis: t(`shopHome.orientation.roles.${role}.tryThis`),
  };
}

/**
 * Where the role's "Try:" prompt points. Captain and crew point at the surface
 * built for their actual shift (today's manifest, check-in); every other role
 * points at a nav page since they have no single "the one boat/counter" today.
 *
 * Every one of those pages is resolved from `staff-destinations.ts`, the one
 * place a staff destination may be declared, rather than spelled out here. The
 * divemaster's prompt is why: it pointed at `/shop/<slug>/blockers`, which has
 * been a 308 to Today's by-departure view since ADR
 * 20260803-not-ready-is-a-view. The registry knew the one-hop URL — including
 * the `?view=` that selects it — and this file did not.
 */
export function orientationTourHref(
  shopSlug: string,
  role: OrientationRole,
  boatBoardingHref: string | undefined,
): string {
  const hrefFor = (id: StaffDestinationId) =>
    staffDestinationHref(staffShopRoot(shopSlug), staffDestination(id));
  switch (role) {
    case "owner":
      return hrefFor("board");
    case "manager":
      return hrefFor("reviews");
    case "instructor":
      return hrefFor("divers");
    case "divemaster":
      return hrefFor("blockers");
    case "captain":
      // Falls back to the operations board when no boat is out today — the
      // manifest route needs a real trip id, and there is no "today's
      // manifest" page without one.
      return boatBoardingHref ?? hrefFor("board");
    case "crew":
      return hrefFor("checkIn");
  }
}
