import { isSampleRelease } from "@/lib/waivers";
import type { AppDb } from "./client";
import { listDiveSites } from "./dive-sites";
import type { Shop, ShopStripeAccount } from "./schema";
import { canAcceptPayments } from "./stripe-accounts";
import { getCurrentWaiverTemplate } from "./waivers-templates";

/** The persisted facts each first-run step reads, in `FirstRunChecklist`'s props. */
export type FirstRunSteps = {
  contactDone: boolean;
  profileDone: boolean;
  unitsDone: boolean;
  diveSiteCount: number;
  releaseDone: boolean;
  stripeDone: boolean;
};

export type FirstRunFacts = { steps: FirstRunSteps; doneCount: number };

/**
 * **What a first-run shop has done, from what it has saved.** The two reads
 * only a first-run shop makes (its dive sites and its live release) plus the
 * shop row and Stripe account the Today page already holds.
 *
 * The release step is done once the live text is the shop's own words, never
 * DiveDay's sample that sign-up published (third UX review, item 30). The trip
 * and public-link rows are guided actions, not completion states, so the
 * progress count leaves them out.
 */
export async function loadFirstRunFacts(
  db: AppDb,
  shop: Pick<
    Shop,
    | "id"
    | "contactEmail"
    | "contactPhone"
    | "tagline"
    | "description"
    | "logoUrl"
    | "unitsConfirmedAt"
  >,
  stripeAccount: ShopStripeAccount | null,
): Promise<FirstRunFacts> {
  const [diveSites, release] = await Promise.all([
    listDiveSites(db, shop.id),
    getCurrentWaiverTemplate(db, shop.id),
  ]);
  const steps: FirstRunSteps = {
    contactDone: Boolean(shop.contactEmail || shop.contactPhone),
    profileDone: Boolean(shop.tagline || shop.description || shop.logoUrl),
    unitsDone: Boolean(shop.unitsConfirmedAt),
    diveSiteCount: diveSites.length,
    releaseDone: !isSampleRelease(release?.body),
    stripeDone: canAcceptPayments(stripeAccount),
  };
  const doneCount = [
    steps.contactDone,
    steps.profileDone,
    steps.unitsDone,
    steps.diveSiteCount > 0,
    steps.releaseDone,
    steps.stripeDone,
  ].filter(Boolean).length;
  return { steps, doneCount };
}
