import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { people, rentalFitProfiles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { DAY_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Makes one diver a **returning** diver — the state the "Anything changed?"
 * step exists for (ADR 20260904-reef-all-the-way-down, D15), plus the fit
 * confirmation D14's recall line reads.
 *
 * There is no UI that can reach either yet. `fit_stated_at` has to predate the
 * booking, which no form can produce for a seat booked five seconds ago, and
 * `fit_confirmed_*` is written by 16h's evening leftover row, which has not
 * landed. Without this route the whole step is unreachable from a spec, which
 * is the same argument `seed-changed-dive-site` and `seed-observed-species`
 * make one table over.
 *
 * It writes only what a real day would have left behind: sizes the diver stated
 * on a previous trip, and a confirmation by a staffer of this shop's own — the
 * profile's shop and person are both resolved here rather than taken from the
 * caller, and the staffer is looked up by name inside the same tenant.
 *
 * Mutating is safe because of the fleet's topology (`e2e/servers.ts`): each
 * Playwright worker owns its own `next start` server and its own in-memory
 * PGlite database, reset before every test. Gated identically to
 * `/api/test/reset`, so it can never be reachable in a real deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
});

/** The staffer who kept the fit — the seeded divemaster, by name inside this tenant. */
const KEEPER_FULL_NAME = "Keiko Tanaka";

/**
 * Long enough before any booking a spec can make that the fit is genuinely last
 * season's.
 *
 * The comparison the page makes is against `bookings.created_at`, which carries
 * the *database's* `now()` rather than the frozen clock this subtracts from. The
 * two only agree in production; here the margin is what makes it safe, and it is
 * wide enough for any plausible gap between `DIVEDAY_CLOCK` and wall time.
 */
const STATED_DAYS_AGO = 60;
/** Recent enough that "after your last trip" is a trip the diver remembers. */
const CONFIRMED_DAYS_AGO = 6;

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!diver) return NextResponse.json({ error: "diver_not_found" }, { status: 404 });

  const [keeper] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, KEEPER_FULL_NAME)))
    .limit(1);
  if (!keeper) return NextResponse.json({ error: "keeper_not_found" }, { status: 404 });

  const now = nowDate();
  const statedAt = new Date(now.getTime() - STATED_DAYS_AGO * DAY_MS);
  const confirmedAt = new Date(now.getTime() - CONFIRMED_DAYS_AGO * DAY_MS);

  const fit = {
    rentsBcd: true,
    rentsRegulator: true,
    rentsWetsuit: true,
    rentsMaskFins: true,
    rentsWeights: true,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHoodGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: "M",
    wetsuitSize: "3 mm / M",
    bootSize: "9",
    finSize: "9",
    weightPreference: "16 lb",
    // The whole point: stated before the seat this spec is about was booked.
    fitStatedAt: statedAt,
    fitConfirmedAt: confirmedAt,
    fitConfirmedBy: keeper.id,
    fitConfirmedItem: "bcd" as const,
    updatedAt: now,
  };
  await db
    .insert(rentalFitProfiles)
    .values({ shopId: shop.id, personId: diver.id, ...fit })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: fit,
    });

  // The contact the panel reads back — a returning diver has one on file, which
  // is what makes the "Not on file" branch a separate state worth its own test.
  await db
    .update(people)
    .set({
      emergencyContactName: "Marisol Vega (sister)",
      emergencyContactPhone: "+1-305-555-0148",
    })
    .where(eq(people.id, diver.id));

  return NextResponse.json({ ok: true });
}
