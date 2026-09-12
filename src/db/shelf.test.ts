// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { saveRentalFitSizes } from "./rental-fit";
import { certifications, people, personRoles, rentalFitProfiles, trips } from "./schema";
import { getShelfPageData } from "./shelf";
import { upcomingTripsWithCounts } from "./trips";
import { getCurrentWaiverTemplate, recordInPersonWaiver } from "./waivers";

/**
 * **What the shelf may show, and the three things it may never.**
 *
 * `/shelf/[token]` is a bearer page a diver may leave open on a phone somebody
 * else picks up, so the promise is structural: the reader cannot return a
 * medical answer, another diver, or a price, whatever the page later decides to
 * render. The first case below walks the whole returned object rather than
 * asserting on the fields somebody remembered — a field added tomorrow is
 * caught by it, which is the entire point.
 */

let seq = 0;

async function diver(db: AppDb, shopId: string, fullName = "Ravi Menon") {
  seq += 1;
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, email: `shelf.read.${seq}@example.com` })
    .returning({ id: people.id });
  if (!row) throw new Error("diver fixture insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row.id;
}

async function owner(db: AppDb, shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

/** Every string and key anywhere in a nested value, flattened for a sweep. */
function walk(value: unknown, path = "$"): { path: string; key: string; text: string }[] {
  if (value === null || value === undefined) return [];
  if (value instanceof Date) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => walk(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [
      { path: `${path}.${key}`, key, text: "" },
      ...walk(child, `${path}.${key}`),
    ]);
  }
  return [{ path, key: "", text: String(value) }];
}

describe("the shelf read's shape", () => {
  it("carries no medical field, under any name, anywhere in it", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Ravi Menon",
      email: `shelf.read.${seq}@example.com`,
    });
    expect(booked.ok).toBe(true);

    // A signed release carrying real medical answers — the exact thing that
    // must not surface. Recorded through the shipped writer, so this is the
    // shape a live record actually has rather than a hand-built row.
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("expected a seeded waiver template");
    await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { personId },
      recordedByPersonId: await owner(db, shop.id),
      medicalAttested: true,
    });

    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    if (!data) throw new Error("expected shelf data");

    const nodes = walk(data);
    // Key names first: nothing on this object may even be *called* medical.
    const medicalKey = /medical|health|condition|diagnos|physician|clearance|questionnaire/i;
    expect(nodes.filter((n) => n.key && medicalKey.test(n.key)).map((n) => n.path)).toEqual([]);
    // Then the values, including every state code the waiver branch can emit.
    expect(nodes.filter((n) => n.text && medicalKey.test(n.text)).map((n) => n.path)).toEqual([]);
  });

  it("carries no price, balance or money field", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    if (!data) throw new Error("expected shelf data");
    const moneyKey = /price|amount|cents|total|balance|refund|tip|paid|deposit|currency/i;
    expect(
      walk(data)
        .filter((n) => n.key && moneyKey.test(n.key))
        .map((n) => n.path),
    ).toEqual([]);
  });

  it("names nobody but the diver it belongs to", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id, "Ravi Menon");
    await diver(db, shop.id, "Zephyrine Uxbridge");
    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    if (!data) throw new Error("expected shelf data");
    const rendered = walk(data)
      .map((n) => n.text)
      .join(" ");
    expect(rendered).not.toContain("Zephyrine");
  });

  it("refuses a person this shop does not have", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    const strangerId = await diver(other.db, other.shop.id, "Someone Else");
    expect(await getShelfPageData(db, { shopId: shop.id, personId: strangerId })).toBeNull();
  });

  it("refuses a record that has been deleted", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));
    expect(await getShelfPageData(db, { shopId: shop.id, personId })).toBeNull();
  });
});

describe("the file the shelf shows", () => {
  it("reads the card the shop holds, and whether anybody checked it", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const reviewer = await owner(db, shop.id);
    const reviewedAt = new Date("2026-08-01T15:00:00Z");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "advanced_open_water",
      identifier: "AOW-9931",
      status: "verified",
      reviewedAt,
      reviewedByPersonId: reviewer,
    });

    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.certification).toMatchObject({
      state: "verified",
      level: "advanced_open_water",
      agency: "padi",
      verifiedAt: reviewedAt,
    });
    // Named, because "checked by somebody" is not what a diver is being told.
    expect(
      data?.file.certification.state === "verified" ? data.file.certification.verifiedBy : null,
    ).toBeTruthy();
    // The card number is evidence the shop holds, never a fact this page shows.
    expect(JSON.stringify(data)).not.toContain("AOW-9931");
  });

  it("reads an unchecked card as on file rather than as verified", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    await db.insert(certifications).values({
      shopId: shop.id,
      personId,
      agency: "ssi",
      level: "open_water",
      status: "pending",
      selfDeclaredAt: nowDate(),
    });
    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.certification).toEqual({
      state: "on_file",
      level: "open_water",
      agency: "ssi",
    });
  });

  it("says nothing on file for a diver with no card", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.certification).toEqual({ state: "none" });
    expect(data?.file.waiver).toEqual({ state: "needs_signing" });
    expect(data?.file.emergencyContactOnFile).toBe(false);
  });

  it("says an emergency contact is on file without saying who", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    await db
      .update(people)
      .set({ emergencyContactName: "Priya Menon", emergencyContactPhone: "+1 305 555 0199" })
      .where(eq(people.id, personId));

    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.emergencyContactOnFile).toBe(true);
    const rendered = JSON.stringify(data);
    expect(rendered).not.toContain("Priya");
    expect(rendered).not.toContain("555 0199");
  });

  it("shows the sizes the shop has, and the diver's save writes the row the rental ticket reads", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);

    await saveRentalFitSizes(db, {
      shopId: shop.id,
      personId,
      bcdSize: "M",
      wetsuitSize: "3mm L",
      bootSize: "42",
      finSize: "L",
    });

    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.sizes).toEqual({
      bcdSize: "M",
      wetsuitSize: "3mm L",
      bootSize: "42",
      finSize: "L",
    });

    // The same row, and only the size columns: which pieces the shop supplies
    // is the shop's answer and a diver's save must not silently change it.
    const [row] = await db
      .select()
      .from(rentalFitProfiles)
      .where(and(eq(rentalFitProfiles.shopId, shop.id), eq(rentalFitProfiles.personId, personId)));
    expect(row?.bcdSize).toBe("M");
    // **And the row it creates claims nothing.** This read `true` until the
    // shelf's writer laid `NOTHING_RENTED` under its insert, and that `true`
    // was the schema's `default(true)` rather than an answer anybody gave: the
    // shelf has no checkbox, so a diver correcting a size stated a fit
    // claiming a BCD, a regulator, a wetsuit, a mask, fins and weights their
    // shop may not rent (`security-reviewer`, issue #1755). An answer already
    // on file is preserved instead — `rental-fit.test.ts` holds that half.
    expect(row?.rentsBcd).toBe(false);
    // A size a diver typed is a stated fit, so the packing list reads it.
    expect(row?.fitStatedAt).not.toBeNull();
  });

  it("clears a size the diver empties", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    await saveRentalFitSizes(db, {
      shopId: shop.id,
      personId,
      bcdSize: "M",
      wetsuitSize: "L",
      bootSize: "42",
      finSize: "L",
    });
    await saveRentalFitSizes(db, {
      shopId: shop.id,
      personId,
      bcdSize: "",
      wetsuitSize: "L",
      bootSize: "42",
      finSize: "L",
    });
    const data = await getShelfPageData(db, { shopId: shop.id, personId });
    expect(data?.file.sizes.bcdSize).toBeNull();
    expect(data?.file.sizes.wetsuitSize).toBe("L");
  });

  it("refuses a size write into another shop's record", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    const strangerId = await diver(other.db, other.shop.id, "Someone Else");
    expect(
      await saveRentalFitSizes(db, {
        shopId: shop.id,
        personId: strangerId,
        bcdSize: "M",
        wetsuitSize: "L",
        bootSize: "42",
        finSize: "L",
      }),
    ).toBeNull();
  });
});

describe("the reasons to come back", () => {
  it("names the seat this diver holds, and counts days behind them", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    seq += 1;
    const email = `shelf.seat.${seq}@example.com`;
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nadia Farouk",
      email,
    });
    if (!booked.ok) throw new Error("expected the booking to succeed");
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, email)))
      .limit(1);
    if (!person) throw new Error("expected the booked diver");

    const data = await getShelfPageData(db, { shopId: shop.id, personId: person.id });
    expect(data?.next?.tripId).toBe(trip.id);
    expect(data?.next?.bookingId).toBe(booked.bookingId);
    // The day has not happened, so it is not a memory and not a count.
    expect(data?.diveCount).toBe(0);
    expect(data?.dives).toEqual([]);
  });

  it("counts a departure only once it is an hour past its return", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    seq += 1;
    const email = `shelf.past.${seq}@example.com`;
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Tomas Vidal",
      email,
    });
    if (!booked.ok) throw new Error("expected the booking to succeed");
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, email)))
      .limit(1);
    const [row] = await db
      .select({ endsAt: trips.endsAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    if (!person || !row) throw new Error("expected the diver and the trip");

    // Half an hour after the scheduled return: boats run late, and the shipped
    // buffer says everyone is still out.
    const stillOut = new Date(row.endsAt.getTime() + 30 * 60 * 1000);
    expect(
      (await getShelfPageData(db, { shopId: shop.id, personId: person.id, now: stillOut }))
        ?.diveCount,
    ).toBe(0);

    const home = new Date(row.endsAt.getTime() + 2 * 60 * 60 * 1000);
    const after = await getShelfPageData(db, { shopId: shop.id, personId: person.id, now: home });
    expect(after?.diveCount).toBe(1);
    expect(after?.dives[0]?.tripId).toBe(trip.id);
    expect(after?.dives[0]?.recapPath).toMatch(/^\/recap\//);
    // The seat is behind them, so it is no longer what is next.
    expect(after?.next).toBeNull();
  });
});
