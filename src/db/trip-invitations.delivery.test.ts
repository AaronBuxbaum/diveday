import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@/lib/notifications/kinds";
import { seededShopContext } from "@/test/db";

/**
 * **Which invitation is commercial** (Aaron, 2026-10-06, issue #1953). A
 * staffer's reply to a diver's own date request is service mail; a cold
 * invitation to a diver who asked for nothing is commercial, so it carries the
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
const { recordCourseInquiry } = await import("./course-inquiries");
const { getCourseBySlug } = await import("./courses");
const { listBookableDivers } = await import("./divers");
const { people, personCourtesyEmailUnsubscribeTokens } = await import("./schema");
const {
  createDirectTripInvitation,
  createTripRequestInvitations,
  deliverTripInvitation,
  listTripInvitations,
} = await import("./trip-invitations");
const { upcomingTripsWithCounts } = await import("./trips");

async function context() {
  const { db, shop } = await seededShopContext();
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
  await createDirectTripInvitation(db, {
    shopId: shop.id,
    tripId: trip.id,
    personId: candidate.person.id,
    createdByPersonId: author.id,
  });
  const row = (await listTripInvitations(db, shop.id, trip.id)).find(
    ({ invitation }) => invitation.personId === candidate.person.id,
  );
  if (!row) throw new Error("direct invitation missing");
  return { invitationId: row.invitation.id, personId: candidate.person.id };
}

function sent(): Notification {
  const call = vi.mocked(sendNotification).mock.calls.at(-1);
  if (!call) throw new Error("nothing was sent");
  return call[1];
}

describe("deliverTripInvitation", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
    vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
  });

  it("sends a cold invitation as commercial mail, with a working unsubscribe link for that diver", async () => {
    const ctx = await context();
    const { invitationId, personId } = await directInvitation(ctx);

    await expect(
      deliverTripInvitation(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        invitationId,
      }),
    ).resolves.toBe("sent");

    const notification = sent();
    expect(notification.kind).toBe("direct_trip_invitation");
    if (notification.kind !== "direct_trip_invitation") return;
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
    const { invitationId, personId } = await directInvitation(ctx);
    await ctx.db
      .update(people)
      .set({ deletedAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, personId));

    await expect(
      deliverTripInvitation(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        invitationId,
      }),
    ).resolves.toBe("fallback");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not email a cold invitation to a diver who opted out, and says so", async () => {
    const ctx = await context();
    const { invitationId, personId } = await directInvitation(ctx);
    await ctx.db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, personId));

    await expect(
      deliverTripInvitation(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        invitationId,
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
    const row = (await listTripInvitations(ctx.db, ctx.shop.id, ctx.trip.id)).find(
      ({ invitation }) => invitation.id === invitationId,
    );
    expect(row?.invitation.invitedAt).not.toBeNull();
  });

  it("answers a diver's own date request as service mail, even after they opted out", async () => {
    const ctx = await context();
    const course = await getCourseBySlug(ctx.db, ctx.shop.id, "open-water-diver");
    if (!course) throw new Error("expected seeded course missing");
    // A diver already on file asks for a date, so the request resolves to a
    // person whose courtesy-email setting could have been consulted.
    const [asker] = await listBookableDivers(ctx.db, ctx.shop.id, ctx.trip.id, {
      query: "mail.example",
    });
    if (!asker?.person.email) throw new Error("expected a seeded diver with an email");
    const request = await recordCourseInquiry(ctx.db, {
      shopId: ctx.shop.id,
      courseId: course.id,
      name: asker.person.fullName,
      email: asker.person.email,
      experienceLevel: "certified",
      divers: 1,
    });
    await createTripRequestInvitations(ctx.db, {
      shopId: ctx.shop.id,
      tripId: ctx.trip.id,
      requestIds: [request.id],
      createdByPersonId: ctx.author.id,
    });
    const row = (await listTripInvitations(ctx.db, ctx.shop.id, ctx.trip.id)).find(
      ({ invitation }) => invitation.courseInquiryId === request.id,
    );
    if (!row) throw new Error("request invitation missing");
    expect(row.person?.id).toBe(asker.person.id);
    await ctx.db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, asker.person.id));

    await expect(
      deliverTripInvitation(ctx.db, {
        shopId: ctx.shop.id,
        shopSlug: ctx.shop.slug,
        tripId: ctx.trip.id,
        invitationId: row.invitation.id,
      }),
    ).resolves.toBe("sent");

    const notification = sent();
    expect(notification.kind).toBe("trip_invitation");
    expect("unsubscribeUrl" in notification).toBe(false);
  });
});
