import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext, seededShopContext } from "@/test/db";

const fileCtx = fileScopedShopContext();

/**
 * **Which offer is commercial** (Aaron, 2026-10-06, issue #1953). A
 * staffer's reply to a diver's own date request is service mail; a cold
 * offer to a diver who asked for nothing is commercial, so it carries the
 * courtesy unsubscribe (and with it the postal footer) and is not sent to a
 * diver who opted out of courtesy email.
 *
 * The send is captured rather than delivered, and the app origin pinned, so
 * these pin what *would* leave — the kind and its unsubscribe link — which the
 * test environment otherwise degrades to the composer fallback before either
 * question is asked.
 */
vi.mock("./notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notifications")>();
  return { ...actual, sendNotification: vi.fn() };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://dive.day" };
});

const { sendNotification } = await import("./notifications");
const { getCourseBySlug } = await import("./courses");
const { listBookableDivers } = await import("./divers");
const { notificationSendQueue, interests, people, personCourtesyEmailUnsubscribeTokens } =
  await import("./schema");
const { deliverSeatOffer } = await import("./interest-offers");
const { ensureDepartureInterest } = await import("./interests");
const { upcomingTripsWithCounts } = await import("./trips");

async function context(base: { db: typeof fileCtx.db; shop: typeof fileCtx.shop } = fileCtx) {
  const { db, shop } = base;
  const [author] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!author || !trip) throw new Error("expected seeded rows missing");
  return { db, shop, author, trip };
}

async function directInvitation(ctx: Awaited<ReturnType<typeof context>>) {
  const { db, shop, author, trip } = ctx;
  const [candidate] = await listBookableDivers(db, shop.id, trip.id, {
    query: "mail.example",
  });
  if (!candidate) throw new Error("expected a bookable seeded diver");
  const interest = await ensureDepartureInterest(db, {
    shopId: shop.id,
    tripId: trip.id,
    personId: candidate.person.id,
    createdByPersonId: author.id,
  });
  if (!interest) throw new Error("shop interest missing");
  return { interestId: interest.interestId, personId: candidate.person.id };
}

/**
 * A departure interest the shop made **from a diver's own date request**: the
 * parent is the person's `date` interest, so the offer answers what they asked for.
 */
async function answerToRequest(ctx: Awaited<ReturnType<typeof context>>, email: string) {
  const { db, shop, author, trip } = ctx;
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("expected seeded course missing");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Rae Asker", email })
    .returning({ id: people.id });
  if (!person) throw new Error("person insert failed");
  const [request] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "date",
      askedBy: "diver",
      personId: person.id,
      courseId: course.id,
      name: "Rae Asker",
      email,
    })
    .returning({ id: interests.id });
  if (!request) throw new Error("date interest insert failed");
  const [answer] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      parentInterestId: request.id,
      tripId: trip.id,
      personId: person.id,
      partySize: 1,
      createdByPersonId: author.id,
    })
    .returning({ id: interests.id });
  if (!answer) throw new Error("answer insert failed");
  return { interestId: answer.id, personId: person.id };
}

function sent(): Notification {
  const call = vi.mocked(sendNotification).mock.calls.at(-1);
  if (!call) throw new Error("nothing was sent");
  return call[1];
}

describe("deliverSeatOffer", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
    vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
  });

  it("sends a cold invitation as commercial mail, with a working unsubscribe link for that diver", async () => {
    const ctx = await context();
    const { interestId, personId } = await directInvitation(ctx);

    await expect(
      deliverSeatOffer(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      }),
    ).resolves.toBe("sent");

    const notification = sent();
    expect(notification.kind).toBe("seat_offer_commercial");
    if (notification.kind !== "seat_offer_commercial") return;
    expect(notification.unsubscribeUrl).toMatch(/^https:\/\/dive\.day\/unsubscribe\/[^/]+$/);
    // The token is minted for the invited person, so the link opts out the
    // diver who received it and nobody else.
    const tokens = await ctx.db
      .select({ personId: personCourtesyEmailUnsubscribeTokens.personId })
      .from(personCourtesyEmailUnsubscribeTokens)
      .where(eq(personCourtesyEmailUnsubscribeTokens.personId, personId));
    expect(tokens).toHaveLength(1);
  });

  it("does not email a cold invitation to a diver deleted since it was made", async () => {
    const ctx = await context();
    const { interestId, personId } = await directInvitation(ctx);
    await ctx.db
      .update(people)
      .set({ deletedAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, personId));

    await expect(
      deliverSeatOffer(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      }),
    ).resolves.toBe("fallback");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not email a cold invitation to a diver who opted out, and says so", async () => {
    const ctx = await context();
    const { interestId, personId } = await directInvitation(ctx);
    await ctx.db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, personId));

    await expect(
      deliverSeatOffer(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      }),
    ).resolves.toBe("opted_out");

    expect(sendNotification).not.toHaveBeenCalled();
    // No link minted for a mail that never went.
    const tokens = await ctx.db
      .select({ personId: personCourtesyEmailUnsubscribeTokens.personId })
      .from(personCourtesyEmailUnsubscribeTokens)
      .where(eq(personCourtesyEmailUnsubscribeTokens.personId, personId));
    expect(tokens).toHaveLength(0);
    // The outreach is still recorded: "Contacted" is staff reaching out, by
    // email or by hand.
    const [row] = await ctx.db.select().from(interests).where(eq(interests.id, interestId));
    expect(row?.offeredAt).not.toBeNull();
  });

  it("answers a diver's own date request as service mail, even after they opted out", async () => {
    const ctx = await context();
    const { interestId, personId } = await answerToRequest(ctx, "rae.asker@example.com");
    await ctx.db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, personId));

    await expect(
      deliverSeatOffer(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      }),
    ).resolves.toBe("sent");

    const notification = sent();
    expect(notification.kind).toBe("seat_offer");
    expect("unsubscribeUrl" in notification).toBe(false);
  });

  /**
   * Issue #2133: every re-send stamped a fresh `invitedAt`, and with it a new
   * unsubscribe token and idempotency key, so any staff role could mail the
   * same diver a cold (commercial) invitation over and over. Aaron,
   * 2026-10-13: a repeat within 24 hours of the last stamp is refused with
   * the composer fallback; roles are not narrowed.
   */
  describe("re-sending a cold offer", () => {
    async function sentOnce() {
      const ctx = await context();
      const { interestId } = await directInvitation(ctx);
      const input = {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      };
      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("sent");
      return { ctx, input };
    }

    async function stampOf(ctx: Awaited<ReturnType<typeof context>>, interestId: string) {
      const [row] = await ctx.db
        .select({ offeredAt: interests.offeredAt })
        .from(interests)
        .where(eq(interests.id, interestId));
      return row?.offeredAt ?? null;
    }

    it("refuses a second email within 24 hours and hands back the composer", async () => {
      const { ctx, input } = await sentOnce();
      const stamped = await stampOf(ctx, input.interestId);

      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("already_sent");

      expect(sendNotification).toHaveBeenCalledTimes(1);
      // The refusal neither mints another link nor moves the window forward.
      const tokens = await ctx.db.select().from(personCourtesyEmailUnsubscribeTokens);
      expect(tokens).toHaveLength(1);
      expect(await stampOf(ctx, input.interestId)).toEqual(stamped);
    });

    it("sends one email for two submits that land together", async () => {
      // A database of its own, not the file's shared transaction: the two
      // submits race for the send window, and inside one wrapping transaction
      // on one connection they never contend, so both would send
      // (src/test/db.ts, "When NOT to use this").
      const ctx = await context(await seededShopContext());
      const { interestId } = await directInvitation(ctx);
      const input = {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      };

      const outcomes = await Promise.all([
        deliverSeatOffer(ctx.db, input),
        deliverSeatOffer(ctx.db, input),
      ]);

      expect(outcomes.sort()).toEqual(["already_sent", "sent"]);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("sends on the next submit when the last one's mail did not go, still marked contacted", async () => {
      const ctx = await context();
      const { interestId } = await directInvitation(ctx);
      const input = {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      };
      vi.mocked(sendNotification).mockResolvedValueOnce({
        status: "failed",
        retryable: false,
        errorCode: "rejected",
      });

      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("fallback");
      expect(await stampOf(ctx, interestId)).toBeInstanceOf(Date);
      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("sent");
      expect(sendNotification).toHaveBeenCalledTimes(2);
    });

    it("keeps the window when the mail is queued for retry, so a staff retry cannot send a second", async () => {
      const ctx = await context();
      const { interestId } = await directInvitation(ctx);
      const input = {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      };
      // The real send, so a thrown provider error lands on the retry queue.
      const actual = await vi.importActual<typeof import("./notifications")>("./notifications");
      vi.mocked(sendNotification).mockImplementation(actual.sendNotification);
      let calls = 0;
      const provider = {
        async send() {
          calls += 1;
          if (calls === 1) throw new Error("provider down");
          return { status: "sent" as const, providerMessageId: "m-2" };
        },
      };

      await expect(deliverSeatOffer(ctx.db, input, provider)).resolves.toBe("fallback");
      await expect(deliverSeatOffer(ctx.db, input, provider)).resolves.toBe("already_sent");

      expect(calls).toBe(1);
      expect(await ctx.db.select().from(notificationSendQueue)).toHaveLength(1);
    });

    it("refuses at 23 hours and sends again once 24 hours have passed", async () => {
      const { ctx, input } = await sentOnce();
      const at = (hours: number) =>
        ctx.db
          .update(interests)
          .set({ emailedAt: new Date(nowDate().getTime() - hours * HOUR_MS) })
          .where(eq(interests.id, input.interestId));

      await at(23);
      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("already_sent");
      await at(24);
      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("sent");
      expect(sendNotification).toHaveBeenCalledTimes(2);
    });

    it("leaves a reply to a diver's own date request unthrottled", async () => {
      const ctx = await context();
      const { interestId } = await answerToRequest(ctx, "rae.asker@example.com");
      const input = {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        interestId,
      };

      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("sent");
      await expect(deliverSeatOffer(ctx.db, input)).resolves.toBe("sent");
      expect(sendNotification).toHaveBeenCalledTimes(2);
    });
  });
});
