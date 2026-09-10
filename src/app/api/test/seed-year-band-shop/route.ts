import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { dropYearBandShop, seedYearBandShop } from "@/db/seed-year-band";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Seed (POST) or drop (DELETE) the one **real** shop DiveDay's homepage band
 * can be exercised against (ADR 20260908-one-hand, decision 6, lever T).
 *
 * The band and the public year card both refuse an `isDemo` tenant, because a
 * demo's shop, boat and site names are typed by whoever minted it (security
 * review, finding 1) — so `privateShop`, which mints exactly such a tenant,
 * cannot stand in here. This route seeds a shop of the kind the band is for:
 * out of search, no staff, no logins, no money, and nothing personal, with a
 * fixed name so the visual baseline holds still. `src/db/seed-year-band.ts`
 * says what it contains.
 *
 * Takes no body: there is one fixture and one shape of it, and a route that
 * accepted a shop *name* here would hand a misconfigured deployment the one
 * thing this exclusion exists to prevent. Gated identically to
 * `/api/test/reset`, so it can never be reachable in a real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const seeded = await db.transaction(async (tx) => seedYearBandShop(tx));
  return NextResponse.json({ ok: true, ...seeded });
}

export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const dropped = await db.transaction(async (tx) => dropYearBandShop(tx));
  return NextResponse.json({ ok: true, dropped });
}
