import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { emailBounces, people, personRoles, shops } from "./schema";

const ctx = fileScopedShopContext();

/**
 * Erasure reaches `email_bounces`: a bounce record is the diver's address in
 * clear. Swept by address, on the shop's rows and on DiveDay's own mail that
 * named no shop, never on another shop's.
 */
describe("anonymizeDiver — bounce records", () => {
  it("deletes the diver's bounces here and on shopless mail, and leaves another shop's", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: `other-reef-${shop.id.slice(0, 8)}`, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("fixture insert failed");

    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Erased Diver", email: "Erased.Diver@example.org" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const bounce = {
      event: "bounce",
      recipient: "erased.diver@example.org",
      bounceType: "Permanent",
      occurredAt: new Date("2026-10-20T14:00:00.000Z"),
    };
    await db.insert(emailBounces).values([
      { ...bounce, shopId: shop.id, providerMessageId: "here", sentByPersonId: owner.id },
      { ...bounce, shopId: null, providerMessageId: "shopless" },
      { ...bounce, shopId: other.id, providerMessageId: "elsewhere" },
      {
        ...bounce,
        shopId: shop.id,
        providerMessageId: "someone-else",
        recipient: "keep@example.org",
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const left = await db
      .select({ id: emailBounces.providerMessageId })
      .from(emailBounces)
      .where(
        and(
          eq(emailBounces.occurredAt, bounce.occurredAt),
          eq(emailBounces.bounceType, "Permanent"),
        ),
      );
    expect(left.map((row) => row.id).sort()).toEqual(["elsewhere", "someone-else"]);
  });

  it("keeps a bounce on mail an erased person sent, without their name", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [sender] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Leaving Staffer", email: "leaving@example.org" })
      .returning({ id: people.id });
    if (!sender) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: sender.id, role: "diver" });
    await db.insert(emailBounces).values({
      shopId: shop.id,
      providerMessageId: "sent-by-them",
      event: "bounce",
      recipient: "diver@example.org",
      sentByPersonId: sender.id,
      occurredAt: new Date("2026-10-20T14:00:00.000Z"),
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: sender.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    const [row] = await db
      .select({ sentBy: emailBounces.sentByPersonId })
      .from(emailBounces)
      .where(eq(emailBounces.providerMessageId, "sent-by-them"));
    expect(row).toEqual({ sentBy: null });
  });
});
