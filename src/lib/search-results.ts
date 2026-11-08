export type PaletteAct = { label: string; href: string };

export type PaletteAnswerView = {
  kind: "diver" | "day" | "departure";
  title: string;
  lines: string[];
  act: PaletteAct;
  more: PaletteAct | null;
};

/** Client-safe projection shared by UI and the feature store; no runtime database import. */
import type { GearItemStatus } from "@/db/schema";

/**
 * The shop-scoped index behind the command palette. Every clause is pinned to
 * one shop, so a bearer of one shop's session can never surface another's
 * people or trips. Capped per group so a broad query stays a quick list, not a
 * dump. Kept to indexed `ilike` on the columns staff actually search by — no
 * new dependency, no full-text engine.
 */

export type DiverHit = { id: string; fullName: string; detail: string | null };

export type TripHit = { id: string; title: string; detail: string };

export type DiveSiteHit = { id: string; name: string };

export type CourseHit = { id: string; slug: string; title: string };

export type OrderHit = { id: string; personName: string; detail: string };

/**
 * A unit of the shop's own gear. `label` is the tag written on it, which the
 * schema says in as many words is "how a wet hand finds the row" — and was the
 * one identifier the shop's search box could not find (issue #719).
 *
 * The **status code**, not its words: this module returns codes and the palette
 * picks the language (`src/i18n/gear-labels.ts`). Carried at all because
 * finding "BCD #14" and learning it is out for service in the same glance is
 * the whole value of the row.
 */
export type GearHit = {
  id: string;
  label: string;
  status: GearItemStatus;
  detail: string | null;
};

export type SearchResults = {
  /**
   * The palette's answer card, when the query names one thing (ADR
   * 20260906-before-you-ask, decision 3). Worded by the route, which has the
   * translator; absent or null when the query names nothing.
   */
  answer?: PaletteAnswerView | null;
  divers: DiverHit[];
  trips: TripHit[];
  diveSites: DiveSiteHit[];
  courses: CourseHit[];
  orders: OrderHit[];
  gear: GearHit[];
};
