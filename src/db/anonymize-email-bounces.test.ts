import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import {
  bookings,
  emailBounces,
  notificationDeliveries,
  notificationSendQueue,
  people,
  personRoles,
  shops,
  waiverRecords,
  waiverTemplates,
} from "./schema";

const ctx = fileScopedShopContext();

/**
 * Erasure reaches `email_bounces`: a bounce record is the diver's address in
 * clear. Swept by address on the shop's own rows only: neither another shop's
 * nor DiveDay's own mail that named no shop is this shop's to delete.
 */
describe("anonymizeDiver — bounce records", () => {
  it("deletes the diver's bounces here and leaves another shop's and DiveDay's own", async () => {
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
    expect(left.map((row) => row.id).sort()).toEqual(["elsewhere", "shopless", "someone-else"]);
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

/**
 * A minor's release names their guardian, a third party whose address the
 * erasure nulls on the waiver row. The same address in this shop's send queue
 * or bounce records goes with it (issue #2949): read off the waiver rows
 * before the scrub nulls them, matched case-insensitively, this shop only.
 */
describe("anonymizeDiver — a minor's guardian address", () => {
  async function fixture(guardianEmails: (string | null)[]) {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [template] = await db
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .orderBy(waiverTemplates.id)
      .limit(1);
    if (!template) throw new Error("expected a seeded waiver template");
    const [minor] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Lena Fischer", email: null })
      .returning({ id: people.id });
    if (!minor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: minor.id, role: "diver" });
    for (const [index, guardianEmail] of guardianEmails.entries()) {
      await db.insert(waiverRecords).values({
        shopId: shop.id,
        personId: minor.id,
        templateId: template.id,
        templateTitle: "Liability release",
        templateVersion: 1,
        templateBody: "the text as it stood",
        tokenHash: `guardian-sweep-${minor.id}-${index}`,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        guardianName: guardianEmail ? "Jordan Fischer" : null,
        guardianEmail,
      });
    }
    return { owner: owner.id, minor: minor.id };
  }

  async function otherShop() {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({
        name: "Other Reef",
        slug: `guardian-reef-${shop.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("fixture insert failed");
    return other.id;
  }

  it("leaves a sibling's queued mail and bounces to the same parent alone", async () => {
    const { db, shop } = ctx;
    const { owner, minor } = await fixture(["jordan.fischer@example.org"]);
    // A brother on the same parent's release: the address is still his contact.
    const { minor: sibling } = await fixture(["Jordan.Fischer@example.org"]);
    const at = new Date("2026-10-23T09:00:00.000Z");
    await db.insert(notificationSendQueue).values({
      shopId: shop.id,
      idempotencyKey: `sibling-mail-${sibling}`,
      recipientEmail: "jordan.fischer@example.org",
      payloadSealed: "v1.sealed",
      nextAttemptAt: at,
    });
    await db.insert(emailBounces).values({
      shopId: shop.id,
      providerMessageId: `sibling-bounce-${sibling}`,
      event: "bounce",
      recipient: "jordan.fischer@example.org",
      occurredAt: at,
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: minor,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const queued = await db
      .select({ key: notificationSendQueue.idempotencyKey })
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.nextAttemptAt, at));
    expect(queued).toEqual([{ key: `sibling-mail-${sibling}` }]);
    const bounced = await db
      .select({ id: emailBounces.providerMessageId })
      .from(emailBounces)
      .where(eq(emailBounces.occurredAt, at));
    expect(bounced).toEqual([{ id: `sibling-bounce-${sibling}` }]);
  });

  it("clears the delivery log's quotes of the guardian address, and nothing else", async () => {
    const { db, shop } = ctx;
    const { owner, minor } = await fixture(["Jordan.Fischer@example.org"]);
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");
    await db.delete(notificationDeliveries).where(eq(notificationDeliveries.bookingId, booking.id));
    const at = new Date("2026-10-23T10:00:00.000Z");
    const row = {
      shopId: shop.id,
      bookingId: booking.id,
      status: "failed" as const,
      attemptedAt: at,
    };
    const [quoted, other] = await db
      .insert(notificationDeliveries)
      .values([
        {
          ...row,
          kind: "waiver_request" as const,
          providerDetail: "550 5.1.1 <JORDAN.fischer@example.org>: recipient rejected",
          sendError: "bounce for jordan.fischer@example.org",
        },
        {
          ...row,
          kind: "trip_recap" as const,
          providerDetail: "550 5.1.1 <someone@example.org>: recipient rejected",
        },
      ])
      .returning({ id: notificationDeliveries.id });
    if (!quoted || !other) throw new Error("fixture insert failed");

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: minor,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select({
        id: notificationDeliveries.id,
        detail: notificationDeliveries.providerDetail,
        error: notificationDeliveries.sendError,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.attemptedAt, at));
    expect(rows.find((r) => r.id === quoted.id)).toMatchObject({ detail: null, error: null });
    expect(rows.find((r) => r.id === other.id)?.detail).toContain("someone@example.org");
  });

  it("deletes this shop's bounces for every guardian on the diver's releases", async () => {
    const { db, shop } = ctx;
    const { owner, minor } = await fixture([
      "Jordan.Fischer@Example.org",
      "sam.f@example.org",
      null,
    ]);
    const elsewhere = await otherShop();
    const bounce = {
      event: "bounce",
      bounceType: "Transient",
      occurredAt: new Date("2026-10-21T09:00:00.000Z"),
    };
    await db.insert(emailBounces).values([
      {
        ...bounce,
        shopId: shop.id,
        providerMessageId: `g1-${minor}`,
        recipient: "jordan.fischer@example.org",
      },
      {
        ...bounce,
        shopId: shop.id,
        providerMessageId: `g2-${minor}`,
        recipient: "SAM.F@example.org",
      },
      {
        ...bounce,
        shopId: elsewhere,
        providerMessageId: `away-${minor}`,
        recipient: "sam.f@example.org",
      },
      {
        ...bounce,
        shopId: null,
        providerMessageId: `shopless-${minor}`,
        recipient: "sam.f@example.org",
      },
      {
        ...bounce,
        shopId: shop.id,
        providerMessageId: `keep-${minor}`,
        recipient: "keep@example.org",
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: minor,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const left = await db
      .select({ id: emailBounces.providerMessageId })
      .from(emailBounces)
      .where(eq(emailBounces.occurredAt, bounce.occurredAt));
    expect(left.map((r) => r.id).sort()).toEqual(
      [`away-${minor}`, `keep-${minor}`, `shopless-${minor}`].sort(),
    );
  });

  it("erases a diver with no guardian address exactly as before", async () => {
    const { db, shop } = ctx;
    const { owner, minor } = await fixture([null]);
    const at = new Date("2026-10-22T09:00:00.000Z");
    await db.insert(notificationSendQueue).values({
      shopId: shop.id,
      idempotencyKey: `no-guardian-${minor}`,
      recipientEmail: "someone@example.org",
      payloadSealed: "v1.sealed",
      nextAttemptAt: at,
    });
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: minor,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);
    const left = await db
      .select({ key: notificationSendQueue.idempotencyKey })
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.nextAttemptAt, at));
    expect(left).toEqual([{ key: `no-guardian-${minor}` }]);
  });
});
