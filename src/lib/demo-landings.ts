import { staffDestinationGates } from "./authz";
import type { DemoRoleId } from "./demo-roles";
import {
  type StaffDestinationId,
  staffDestination,
  staffDestinationHref,
  staffShopRoot,
  visibleStaffDestinations,
} from "./staff-destinations";

/**
 * **Where a marketing door drops a visitor inside the demo.** A feature page
 * about the gear register that opens the demo on Today makes the reader go
 * looking for the thing they came to see, so each feature page's door names
 * the screen it is about, and the demo lands there once it has minted the
 * visitor's shop and signed them in (`enterDemoAction`).
 *
 * A closed list of staff destinations, never a path: the value arrives in a
 * posted form field, so anything a visitor could type there has to resolve to
 * a page this registry already knows, inside the shop that was minted for
 * them a moment ago. `demoLandingFrom` is the only reader, and it answers
 * `null` for anything off the list, which lands on Today as every door did
 * before this existed.
 *
 * Every entry is a page the demo's owner can open, and every entry is a page
 * some door lands on: a landing nothing uses is one more value a crafted form
 * can name. A role with a narrower gate (a captain on the release settings)
 * would meet that page's own refusal, so a door pairs a landing with the
 * owner unless the landing is Today, which every role has.
 */
export const DEMO_LANDINGS = [
  "today",
  "board",
  "gear",
  "orders",
  "courses",
  "diveSites",
  "waivers",
  "inbox",
] as const satisfies readonly StaffDestinationId[];

export type DemoLanding = (typeof DEMO_LANDINGS)[number];

const LANDINGS = new Set<string>(DEMO_LANDINGS);

/** A posted `landing` field, held to the list; `null` for anything else. */
export function demoLandingFrom(value: unknown): DemoLanding | null {
  return typeof value === "string" && LANDINGS.has(value) ? (value as DemoLanding) : null;
}

/**
 * The page a demo door lands this role on, inside the shop minted for it,
 * built through the staff registry.
 *
 * The slug is escaped rather than trusted. The one caller passes a slug the
 * server minted from fixed word lists, `[a-z-]` and nothing else, so today the
 * escape changes nothing; it is what keeps the redirect inside one `/shop/`
 * segment for a caller that one day passes something else (security review,
 * 2026-10-05). The closed list only ever guarded the part after it.
 *
 * A landing this role's gate refuses lands on Today instead. Every door the
 * site ships pairs its landing with a role that passes the gate
 * (`src/lib/feature-pages.test.ts`), so only a form someone edited reaches
 * this, and it is greeted by Today rather than a refusal notice. The page's
 * own gate stays the boundary either way.
 */
export function demoLandingPath(
  shopSlug: string,
  role: DemoRoleId,
  landing: DemoLanding | null,
): string {
  const root = staffShopRoot(encodeURIComponent(shopSlug));
  if (!landing) return root;
  const opens = visibleStaffDestinations(staffDestinationGates([role])).some(
    ({ id }) => id === landing,
  );
  return opens ? staffDestinationHref(root, staffDestination(landing)) : root;
}
