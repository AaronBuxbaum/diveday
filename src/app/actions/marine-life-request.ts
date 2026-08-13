"use server";

import { getDb } from "@/db/client";
import { getDiveSite } from "@/db/dive-sites";
import { recordMarineLifeRequest } from "@/db/marine-life-requests";
import { requireStaffSession } from "@/lib/session";

/**
 * "Tell us what we are missing" — a shop asking DiveDay for a species the
 * catalog does not carry.
 *
 * The field guide is a selection from `MARINE_LIFE_CATALOG` and nothing else,
 * so a shop diving outside the tropical western Atlantic meets a picker that
 * refuses its reef (ADR 20260813-marine-life-is-diveday-copy). Until this
 * existed the refusal said "tell us" and pointed nowhere, which was the only
 * place in the product that asked a shop to contact DiveDay without saying how.
 *
 * It lands in `marine_life_requests` and is read by nobody: DiveDay queries the
 * table when deciding which species the catalog grows by, and the answer
 * arrives as a release. Deliberately not a notification — a species request is
 * not urgent, and a page nobody built is better than an email nobody reads.
 *
 * Lives in `src/app/actions/` because the picker it belongs to is rendered by
 * both dive-site pages (`new` and `[id]`), which is exactly the shared-across-
 * pages case AGENTS.md reserves this folder for.
 */
export async function requestMarineLifeSpecies(
  query: string,
  diveSiteId: string | null,
): Promise<void> {
  const session = await requireStaffSession();
  const db = await getDb();
  // The site id arrives from the browser, so it is checked against this
  // staffer's own shop before it is stored. Nothing here is worth stealing, but
  // a cross-tenant id landing in a row is a tenant-isolation hole regardless of
  // what the row is for, and the read costs one indexed lookup on a form that
  // submits once.
  const site = diveSiteId ? await getDiveSite(db, session.user.shopId, diveSiteId) : null;
  await recordMarineLifeRequest(db, {
    shopId: session.user.shopId,
    requestedByPersonId: session.user.personId,
    query,
    diveSiteId: site?.id ?? null,
  });
}
