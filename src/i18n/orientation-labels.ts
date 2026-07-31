import type { Role } from "@/lib/authz";
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
 */
export function orientationTourHref(
  shopSlug: string,
  role: OrientationRole,
  boatBoardingHref: string | undefined,
): string {
  switch (role) {
    case "owner":
      return `/shop/${shopSlug}/schedule`;
    case "manager":
      return `/shop/${shopSlug}/reviews`;
    case "instructor":
      return `/shop/${shopSlug}/divers`;
    case "divemaster":
      return `/shop/${shopSlug}/blockers`;
    case "captain":
      // Falls back to the schedule when no boat is out today — the manifest
      // route needs a real trip id, and there is no "today's manifest" page
      // without one.
      return boatBoardingHref ?? `/shop/${shopSlug}/schedule`;
    case "crew":
      return `/shop/${shopSlug}/check-in`;
  }
}
