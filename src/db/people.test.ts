import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isUniqueConstraintViolation } from "@/db/client";
import { firstHandLocale } from "@/i18n/negotiate";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { findOrCreatePerson, recordDiverOwnLocale, recordDiverOwnLocaleForBooking } from "./people";
import { bookings, people, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

describe("findOrCreatePerson (CR-008)", () => {
  it("creates a new person when no active match exists", async () => {
    const { db, shop } = await seededShopContext();
    const result = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(result.created).toBe(true);
    expect(result.person.email).toBe("nora@example.com");
  });

  it("reuses the existing active person for the same email instead of splitting identity", async () => {
    const { db, shop } = await seededShopContext();
    const first = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const second = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Q. Quinn", // a re-entered name doesn't fork the record
      email: "nora@example.com",
    });
    expect(second.created).toBe(false);
    expect(second.person.id).toBe(first.person.id);

    const rows = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "nora@example.com")));
    expect(rows).toHaveLength(1);
  });

  it("treats email matching as case-insensitive, matching the database constraint", async () => {
    const { db, shop } = await seededShopContext();
    const first = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    // Callers are expected to normalize before calling (every current call
    // site does — src/db/bookings.ts, waitlist.ts, divers.ts, import.ts all
    // .trim().toLowerCase() first), so this exercises the same lowercase
    // value a normalized caller would pass, proving reuse still converges.
    const second = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(second.person.id).toBe(first.person.id);
  });

  it("reports nameMatches for the H-13 identity safeguard", async () => {
    const { db, shop } = await seededShopContext();
    const created = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    // A brand-new person always matches — the submitted name IS the person.
    expect(created.nameMatches).toBe(true);

    // Same human, re-typed with a middle initial: reused and still a match.
    const sameHuman = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Q. Quinn",
      email: "nora@example.com",
    });
    expect(sameHuman.created).toBe(false);
    expect(sameHuman.nameMatches).toBe(true);

    // A different human on the shared inbox: reused, but flagged as a mismatch.
    const differentHuman = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Ben Quinn",
      email: "nora@example.com",
    });
    expect(differentHuman.created).toBe(false);
    expect(differentHuman.person.id).toBe(created.person.id);
    expect(differentHuman.nameMatches).toBe(false);
  });

  it("scopes to the shop: the same email at a different shop is a different person", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop-people-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const here = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const elsewhere = await findOrCreatePerson(db, {
      shopId: otherShop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(elsewhere.person.id).not.toBe(here.person.id);
  });
});

describe("people_shop_email_unique (CR-008)", () => {
  it("the database itself rejects a second active person with the same email in different casing", async () => {
    const { db, shop } = await seededShopContext();
    await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email: "nora@example.com" });

    let caught: unknown;
    try {
      await db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Nora Q.", email: "NORA@Example.com" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isUniqueConstraintViolation(caught)).toBe(true);
  });

  it("frees the email once the holder is soft-deleted, so a genuinely new person can take it", async () => {
    const { db, shop } = await seededShopContext();
    const [original] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email: "nora@example.com" })
      .returning();
    if (!original) throw new Error("insert failed");
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, original.id));

    await expect(
      db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Nora Quinn II", email: "nora@example.com" }),
    ).resolves.toBeDefined();
  });

  it("does not constrain people with no email on file", async () => {
    const { db, shop } = await seededShopContext();
    await db.insert(people).values({ shopId: shop.id, fullName: "Walk-up One", email: null });
    await expect(
      db.insert(people).values({ shopId: shop.id, fullName: "Walk-up Two", email: null }),
    ).resolves.toBeDefined();
  });
});

describe("recordDiverOwnLocale (docs ADR 20260731-per-person-notification-locale)", () => {
  async function newPerson(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
  ) {
    const result = await findOrCreatePerson(db, {
      shopId,
      fullName: "Ingrid Vogel",
      email: `ingrid-${crypto.randomUUID()}@example.com`,
    });
    return result.person;
  }

  async function storedLocale(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    personId: string,
  ) {
    const [row] = await db
      .select({ locale: people.locale })
      .from(people)
      .where(eq(people.id, personId));
    return row?.locale ?? null;
  }

  /**
   * The attack this gate exists for. `findOrCreatePerson` reuses an existing
   * diver by email and a name mismatch only *flags* the booking (H-13) — so
   * without the identity check, anyone who knew a diver's address could book
   * an open seat with `Accept-Language: es-ES` and permanently switch that
   * diver's confirmations, waiver requests, and night-before brief into a
   * language they don't read. Unauthenticated, one seat, no way for the victim
   * to notice (security-reviewer finding).
   */
  it("refuses to record a locale from an identity-unconfirmed booking", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("no seeded trip");

    const victimEmail = `ingrid-${crypto.randomUUID()}@example.com`;
    const victim = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Ingrid Vogel",
      email: victimEmail,
    });
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: victim.person.id,
      locale: "en-US",
    });

    // An impostor books a seat in the victim's name, under a different name —
    // enough to reuse the person row, and enough to flag the booking.
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Someone Else Entirely",
        email: victimEmail,
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;

    await recordDiverOwnLocaleForBooking(db, { bookingId, locale: "es-ES" });
    expect(await storedLocale(db, victim.person.id)).toBe("en-US");
  });

  it("records from a booking whose identity was never in doubt", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("no seeded trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ingrid Vogel",
        email: `ingrid-${crypto.randomUUID()}@example.com`,
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!row) throw new Error("booking has no person");

    await recordDiverOwnLocaleForBooking(db, { bookingId, locale: "es-ES" });
    expect(await storedLocale(db, row.personId)).toBe("es-ES");
  });

  it("starts null — a person DiveDay has never heard from first-hand", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    expect(await storedLocale(db, person.id)).toBeNull();
  });

  it("records what the diver's own request asked for", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: person.id,
      locale: firstHandLocale("de-DE;q=0.2,es-MX;q=0.9"),
    });
    expect(await storedLocale(db, person.id)).toBe("es-ES");
  });

  it("lets the most recent first-hand signal win — people change devices", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    await recordDiverOwnLocale(db, { shopId: shop.id, personId: person.id, locale: "es-ES" });
    await recordDiverOwnLocale(db, { shopId: shop.id, personId: person.id, locale: "en-US" });
    expect(await storedLocale(db, person.id)).toBe("en-US");
  });

  it("treats null as 'nothing learned', never as a clear", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    await recordDiverOwnLocale(db, { shopId: shop.id, personId: person.id, locale: "es-ES" });
    // A later visit from a device asking for a language DiveDay doesn't carry:
    // the page falls back to the shop's locale, but that says nothing new about
    // this diver, so what they told us before must survive.
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: person.id,
      locale: firstHandLocale("fr-FR"),
    });
    expect(await storedLocale(db, person.id)).toBe("es-ES");
  });

  it("never lets a garbage or hostile Accept-Language reach the column", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    const hostile = ["", ";;;", "*", "🙂", "en;q=notanumber", "de-DE", "x".repeat(5_000)];
    for (const header of hostile) {
      await recordDiverOwnLocale(db, {
        shopId: shop.id,
        personId: person.id,
        locale: firstHandLocale(header),
      });
      expect(await storedLocale(db, person.id)).toBeNull();
    }

    // A payload that *does* carry a real language tag still only ever writes
    // the matched constant — never the attacker's string, which is the whole
    // reason this takes a `DiverLocale` and not a header.
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: person.id,
      locale: firstHandLocale("es-ES'; UPDATE people SET locale='xx"),
    });
    expect(await storedLocale(db, person.id)).toBe("es-ES");
    await db.update(people).set({ locale: null }).where(eq(people.id, person.id));

    // Belt and braces: even a caller that bypasses `firstHandLocale` and hands
    // over a raw string can't write one DiveDay carries no bundle for.
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: person.id,
      locale: "de-DE" as unknown as DiverLocale,
    });
    expect(await storedLocale(db, person.id)).toBeNull();
  });

  it("refuses to write across shops even when handed a real person id", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Elsewhere", slug: "elsewhere-locale-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await recordDiverOwnLocale(db, {
      shopId: otherShop.id,
      personId: person.id,
      locale: "es-ES",
    });
    expect(await storedLocale(db, person.id)).toBeNull();
  });

  it("leaves a soft-deleted person alone", async () => {
    const { db, shop } = await seededShopContext();
    const person = await newPerson(db, shop.id);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, person.id));
    await recordDiverOwnLocale(db, { shopId: shop.id, personId: person.id, locale: "es-ES" });
    expect(await storedLocale(db, person.id)).toBeNull();
  });

  it("is not reachable through findOrCreatePerson — the staff/import path can't set it", async () => {
    // The structural half of the rule: a staff-triggered action carries the
    // *staff* member's Accept-Language, so identity creation deliberately has
    // no locale parameter for a caller to pass one into. Booking a walk-in from
    // a staff surface must leave the column null.
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips[0];
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const email = `walkup-${crypto.randomUUID()}@example.com`;
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Counter Walk-Up",
        email,
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const [row] = await db.select().from(people).where(eq(people.email, email));
    expect(row?.locale ?? null).toBeNull();
  });
});
