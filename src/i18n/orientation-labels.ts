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
  | "assistant_instructor"
  | "divemaster"
  | "captain"
  | "crew";

/**
 * Precedence when a person holds more than one staff role.
 *
 * It used to claim to match the demo role switcher's "current role" pill
 * exactly. It no longer does: that pill (`ShopChrome.tsx`, `PublicShopShell.tsx`)
 * enumerates `instructor | divemaster | captain` and falls through to `diver`,
 * and `assistant_instructor` was added here and not there — deliberately, since
 * `DEMO_ROLE_IDS` is a curated five personas a visitor can *be*, not the role
 * vocabulary. So in a demo shop an AI's pill reads "Diver" while this card
 * greets them as an assistant instructor. Demo-only, and the honest reading of
 * the pill is "which demo persona am I" rather than "which role do I hold"
 * (issue #1680, dive-domain review).
 */
const ROLE_PRECEDENCE: readonly OrientationRole[] = [
  "owner",
  "manager",
  "instructor",
  "assistant_instructor",
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
 * divemaster's prompt is why: it pointed at `/shop/<slug>/blockers`, a 308 to a
 * surface that had already moved twice. It points at Today now, which is where
 * a diver who cannot board is a row on their boat's station (ADR
 * 20260827-clearwater-surface-language, decision 4).
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
    case "assistant_instructor":
      // The students they are assisting, and the records they need before a
      // training dive — the same door as the instructor they work under,
      // because that is the reading their morning starts with (issue #1680).
      return hrefFor("divers");
    case "divemaster":
      return hrefFor("today");
    case "captain":
      // Falls back to the operations board when no boat is out today — the
      // manifest route needs a real trip id, and there is no "today's
      // manifest" page without one.
      return boatBoardingHref ?? hrefFor("board");
    case "crew":
      return hrefFor("checkIn");
  }
}
