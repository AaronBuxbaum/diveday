import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { readActiveStaffRoles } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { issueDiverSignIn } from "../../db/diver-sign-in";
import { createPerson } from "../../db/people";
import { shops } from "../../db/schema/index";
import { getShopCurrency } from "../../db/stripe-accounts";
import { createTrip, listStaff } from "../../db/trips";
import { grantTripCredit } from "../../features/money/trip-credit";
import { HOUR_MS } from "../../lib/clock";

/**
 * **A signed-in diver with trip credit** (`signedInDiver`, ADR
 * 20261125-diver-sign-in): one diver on file holding a goodwill grant that
 * covers a plain seat on a departure three days out, and the sign-in link the
 * email would carry. A private shop only: it turns the shop's tax off, which
 * a credit spend needs.
 */
export async function prepareSignedInDiver(db: AppDb, shop: { id: string }, now: Date) {
  let owner: string | undefined;
  for (const staff of await listStaff(db, shop.id)) {
    if ((await readActiveStaffRoles(db, shop.id, staff.person.id))?.includes("owner")) {
      owner = staff.person.id;
      break;
    }
  }
  if (!owner) throw new Error("signed-in diver fixture needs an active shop owner");
  await db
    .update(shops)
    .set({ taxEnabled: false, passThroughFee: null })
    .where(eq(shops.id, shop.id));
  const currency = await getShopCurrency(db, shop.id);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Morning Two-Tank",
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    capacity: 12,
    plannedDives: 2,
    priceCents: 9_500,
  });
  if (!trip) throw new Error("signed-in diver fixture could not create its trip");
  const email = "marisol.vega@example.com";
  const person = await createPerson(db, {
    shopId: shop.id,
    fullName: "Marisol Vega",
    email,
    phone: null,
    origin: "counter",
  });
  const granted = await grantTripCredit(db, {
    shopId: shop.id,
    personId: person.id,
    actorPersonId: owner,
    attemptId: randomUUID(),
    currency,
    amountCents: 15_000,
    reason: "goodwill",
  });
  if (!granted.ok) throw new Error(`signed-in diver grant refused: ${granted.reason}`);
  const issued = await issueDiverSignIn(db, { shopId: shop.id, email, now });
  if (!issued) throw new Error("signed-in diver fixture minted no link");
  return { token: issued.token, email, tripId: trip.id };
}
