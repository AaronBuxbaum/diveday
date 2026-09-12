// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { prepareContactImport } from "@/lib/import";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { createDiver, updateDiver } from "./divers";
import { commitContactImport } from "./import";
import { findOrCreatePerson } from "./people";
import { storedPhone } from "./person-phone";
import { people, shops, userAccounts } from "./schema";
import { registerDiverAtShop } from "./self-registration";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **Every writer of `people.phone` normalises, and this file is the list.**
 *
 * The column used to hold whatever a caller passed, with the shop's country
 * applied at *read* time instead (`phoneMatches`, on every inbound SMS and
 * WhatsApp message). A bare `7700900123` therefore meant `+447700900123` while
 * the shop's address said GB and `+17700900123` the moment an owner or manager
 * edited it to US — no write to the row at all. What follows a flip is a
 * stranger's message filed on a named diver's conversation, and a staffer
 * answering that thread replying to the stranger, since the reply goes to the
 * address the message came from and never to the one on file
 * (src/db/staff-reply.ts). The converse is the real diver's `STOP` silently
 * becoming `unknown_sender`.
 *
 * Two writers are pinned where their harness already lives rather than here —
 * the seat claimant's contact write in `seat-claims.test.ts`, and the CSV
 * importer's update-in-place branch in `import.test.ts`.
 */
describe("people.phone is E.164 on write", () => {
  const bare = "305-555-0140";
  const e164 = "+13055550140";

  it("storedPhone reads the shop's own country, and keeps a number it cannot read", async () => {
    const { db, shop } = await seededShopContext();
    expect(await storedPhone(db, shop.id, bare)).toBe(e164);
    // Already international: the shop's country is not consulted at all, which
    // is what makes a normalised column immune to the setting changing.
    expect(await storedPhone(db, shop.id, "+44 7700 900123")).toBe("+447700900123");
    expect(await storedPhone(db, shop.id, null)).toBeNull();
    expect(await storedPhone(db, shop.id, "   ")).toBeNull();

    // A shop with no country on file cannot resolve a bare number, and the
    // typed text is stored rather than lost.
    await db.update(shops).set({ addressCountry: null }).where(eq(shops.id, shop.id));
    expect(await storedPhone(db, shop.id, bare)).toBe(bare);
  });

  it("createDiver and updateDiver", async () => {
    const { db, shop } = await seededShopContext();
    const created = await createDiver(db, {
      shopId: shop.id,
      fullName: "Nadia Okonkwo",
      email: `nadia-${randomUUID()}@example.com`,
      phone: bare,
    });
    if (!created) throw new Error("createDiver returned null");
    expect(created.phone).toBe(e164);

    await updateDiver(db, {
      shopId: shop.id,
      personId: created.id,
      fullName: "Nadia Okonkwo",
      phone: "(305) 555 0141",
    });
    const [updated] = await db.select().from(people).where(eq(people.id, created.id));
    expect(updated?.phone).toBe("+13055550141");
  });

  it("findOrCreatePerson — the chokepoint every public door shares", async () => {
    const { db, shop } = await seededShopContext();
    const email = `nora-${randomUUID()}@example.com`;
    const { person, created } = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email,
      phone: bare,
    });
    expect(created).toBe(true);
    expect(person.phone).toBe(e164);
  });

  it("the no-email booking insert — a counter walk-in with only a number", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Walk-in Diver",
      phone: bare,
    });
    if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
    const [row] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.id, outcome.personId)));
    expect(row?.phone).toBe(e164);
  });

  it("self-registration — the counter QR, where the diver types their own number", async () => {
    const { db, shop } = await seededShopContext();
    // Phone-only: no email to match on, so this is the branch that inserts
    // directly rather than going through findOrCreatePerson.
    const walkIn = await registerDiverAtShop(db, {
      shopId: shop.id,
      fullName: "Ines Oyelaran",
      email: null,
      phone: bare,
    });
    const [phoneOnly] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, walkIn.personId));
    expect(phoneOnly?.phone).toBe(e164);

    const withEmail = await registerDiverAtShop(db, {
      shopId: shop.id,
      fullName: "Ines Oyelaran",
      email: `ines-${randomUUID()}@example.com`,
      phone: "(305) 555 0142",
    });
    const [matched] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, withEmail.personId));
    expect(matched?.phone).toBe("+13055550142");
  });

  it("the contact importer — where the numbers are another system's export", async () => {
    const { db, shop } = await seededShopContext();
    const [account] = await db
      .select({ personId: userAccounts.personId })
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email))
      .limit(1);
    if (!account) throw new Error("owner account missing");
    const email = `bulk-${randomUUID()}@example.com`;
    const csv = ["full_name,email,phone", `Bulk Bianca,${email},${bare}`].join("\n");
    await commitContactImport(db, shop.id, prepareContactImport(csv), account.personId);

    const [row] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, email)));
    expect(row?.phone).toBe(e164);
  });
});
