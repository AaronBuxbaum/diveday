import { expect, it } from "vitest";
import { readDiverSession, startDiverSession } from "../../db/diver-sign-in";
import { getShopBySlug } from "../../db/shops";
import { getTripWithBooked } from "../../db/trips";
import { plainSeatCreditFare, readTripCredit } from "../../features/money/trip-credit";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { prepareSignedInDiver } from "./signed-in-diver";

const context = fileScopedShopContext();

it("signs a diver in whose credit covers a plain seat on its departure", async () => {
  const { db, shop } = context;
  const now = nowDate();
  const fact = await prepareSignedInDiver(db, shop, now);
  const session = await startDiverSession(db, { token: fact.token });
  expect(session).not.toBeNull();
  const signedIn = await readDiverSession(db, { shopId: shop.id, token: session?.token });
  const shopNow = await getShopBySlug(db, shop.slug);
  const trip = await getTripWithBooked(db, shop.id, fact.tripId);
  if (!shopNow || !trip || !signedIn) throw new Error("expected the shop, the trip and a diver");
  const fare = plainSeatCreditFare(trip, shopNow, now);
  const { balanceCents } = await readTripCredit(db, shop.id, signedIn.personId, shopNow.currency);
  expect(fare).not.toBeNull();
  expect(balanceCents ?? 0).toBeGreaterThanOrEqual(fare ?? Number.POSITIVE_INFINITY);
});
