import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { CONFIRMATION_WINDOW_MS, confirmationCode } from "@/lib/reply-keywords";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { recordInboundMessage } from "./inbound-messages";
import { handleInboundReplyKeyword } from "./reply-keywords";
import { bookings, inboundMessages, people, staffReplies, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The failure paths are the feature** (ADR 20260909-reply-keywords).
 *
 * A `C` is a state change asked for by a sender nobody authenticated beyond an
 * address, so what this file mostly asserts is everything that must *not*
 * happen: a stranger's keyword, a sentence read as a command, a code with no
 * pending cancellation behind it, a second departure guessed at, a seat on a
 * boat that has left, and the same provider message delivered twice.
 *
 * The happy path is here too, and it is deliberately two messages long: the
 * first `C` names the departure and changes nothing.
 */

const DIVER = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

/** A provider that accepts everything and keeps what it was handed. */
function acceptingProvider(): NotificationProvider & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    sent,
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `ses-${sent.length}` };
    },
  };
}

/** The body of the automatic reply DiveDay sent, as the diver would read it. */
function replyBodies(sent: Notification[]): string[] {
  return sent.flatMap((notification) =>
    notification.kind === "staff_reply" ? [notification.body] : [],
  );
}

async function context() {
  const { db, shop } = await seededShopContext();
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (trip) => trip.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!open) throw new Error("expected seeded trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    ...DIVER,
  });
  if (!booked.ok) throw new Error("setup booking failed");
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.email, DIVER.email)))
    .limit(1);
  if (!diver) throw new Error("setup diver missing");
  // Every departure this diver could reply about is inside the trip's own
  // future, so the frozen instant below has to be before it.
  const now = new Date(open.startsAt.getTime() - 24 * 60 * 60 * 1000);
  return { db, shop, trip: open, bookingId: booked.bookingId, personId: diver.id, now };
}

let sequence = 0;

async function inbound(
  db: AppDb,
  shopId: string,
  body: string,
  options: {
    from?: string;
    channel?: "email" | "whatsapp";
    receivedAt: Date;
    senderAuthenticated?: boolean;
  },
) {
  sequence += 1;
  const result = await recordInboundMessage(db, {
    shopId,
    channel: options.channel ?? "email",
    fromAddress: options.from ?? DIVER.email,
    body,
    receivedAt: options.receivedAt,
    providerMessageId: `provider-${sequence}`,
    senderAuthenticated: options.senderAuthenticated,
  });
  if (result.status !== "recorded") throw new Error(`unexpected ${result.status}`);
  return result.id;
}

async function statusOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

describe("handleInboundReplyKeyword — what it refuses", () => {
  it("leaves a sentence alone and changes nothing", async () => {
    const { db, shop, bookingId, now } = await context();
    const provider = acceptingProvider();
    const messageId = await inbound(db, shop.id, "Can I cancel and move to Sunday?", {
      receivedAt: now,
    });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("not_a_keyword");
    expect(await statusOf(db, bookingId)).toBe("booked");
    expect(provider.sent).toHaveLength(0);
  });

  it("never reads a keyword out of a message nobody vouched for", async () => {
    const { db, shop, bookingId, now } = await context();
    const provider = acceptingProvider();
    // The address is the diver's own; the *channel* did not authenticate it,
    // so `recordInboundMessage` files it as a stranger and this must not act.
    const messageId = await inbound(db, shop.id, "C", {
      receivedAt: now,
      senderAuthenticated: false,
    });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("unknown_sender");
    expect(await statusOf(db, bookingId)).toBe("booked");
    expect(provider.sent).toHaveLength(0);
  });

  it("refuses a code that no pending cancellation stands behind", async () => {
    const { db, shop, bookingId, personId, now } = await context();
    const provider = acceptingProvider();
    // A genuine, correctly-signed code — and still worth nothing, because the
    // diver never asked. Possession of a code is not the evidence; the round
    // trip is.
    const code = confirmationCode(
      {
        shopId: shop.id,
        bookingId,
        personId,
        channel: "email",
        toAddress: DIVER.email,
      },
      now.getTime(),
    );
    const messageId = await inbound(db, shop.id, code, { receivedAt: now });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("not_a_keyword");
    expect(await statusOf(db, bookingId)).toBe("booked");
    expect(provider.sent).toHaveLength(0);
  });

  it("answers a wrong code without changing anything, and leaves the shop the message", async () => {
    const { db, shop, bookingId, now } = await context();
    const provider = acceptingProvider();
    await handleInboundReplyKeyword(db, {
      shopId: shop.id,
      inboundMessageId: await inbound(db, shop.id, "C", { receivedAt: now }),
      now,
      provider,
    });
    const guessId = await inbound(db, shop.id, "2222ZZ", {
      receivedAt: new Date(now.getTime() + 1000),
    });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: guessId,
        now: new Date(now.getTime() + 1000),
        provider,
      }),
    ).toBe("code_mismatch");
    expect(await statusOf(db, bookingId)).toBe("booked");
    const [guess] = await db
      .select({ answeredAt: inboundMessages.answeredAt })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, guessId));
    expect(guess?.answeredAt).toBeNull();
  });

  it("refuses a `C` when the departure has already sailed", async () => {
    const { db, shop, trip, bookingId } = await context();
    const provider = acceptingProvider();
    // Past the one-hour late-departure buffer, which is the same line
    // `selfCancelBooking` draws.
    const afterwards = new Date(trip.startsAt.getTime() + 2 * 60 * 60 * 1000);
    const messageId = await inbound(db, shop.id, "C", { receivedAt: afterwards });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now: afterwards,
        provider,
      }),
    ).toBe("nothing_to_cancel");
    expect(await statusOf(db, bookingId)).toBe("booked");
  });

  it("hands over rather than guessing when the diver holds two seats", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    const provider = acceptingProvider();
    // Any other departure this diver could still release — the point is two
    // live candidates, not which two.
    const second = (await upcomingTripsWithCounts(db, shop.id)).find(
      (candidate) => candidate.id !== trip.id && candidate.startsAt.getTime() > now.getTime(),
    );
    if (!second) throw new Error("expected a second seeded trip");
    const alsoBooked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      ...DIVER,
    });
    if (!alsoBooked.ok) throw new Error("setup second booking failed");
    const messageId = await inbound(db, shop.id, "C", { receivedAt: now });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("ambiguous");
    expect(await statusOf(db, bookingId)).toBe("booked");
    expect(await statusOf(db, alsoBooked.bookingId)).toBe("booked");
    // Still on the worklist: a person has to sort this out.
    const [row] = await db
      .select({ answeredAt: inboundMessages.answeredAt })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, messageId));
    expect(row?.answeredAt).toBeNull();
  });

  it("refuses a number that merely ends the same way as the diver's", async () => {
    const { db, shop, bookingId, personId, now } = await context();
    const provider = acceptingProvider();
    // The diver's phone, reachable on WhatsApp, stored with its country code.
    await db.update(people).set({ phone: "+1-305-555-0142" }).where(eq(people.id, personId));
    // A different number in a different country whose last ten digits are the
    // diver's. `phoneMatches` files this on their record — attribution's own
    // trade — and a keyword must still refuse it.
    const messageId = await inbound(db, shop.id, "C", {
      channel: "whatsapp",
      from: "443055550142",
      receivedAt: now,
    });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("unknown_sender");
    expect(await statusOf(db, bookingId)).toBe("booked");
    expect(provider.sent).toHaveLength(0);
  });

  it("acts once when the provider delivers the same message twice", async () => {
    const { db, shop, now } = await context();
    // The replay guard is `recordInboundMessage`'s own unique index: a
    // redelivery answers `duplicate`, and the webhook only calls this for a
    // row it actually filed. This asserts the property the routes rely on.
    const first = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: DIVER.email,
      body: "C",
      receivedAt: now,
      providerMessageId: "replayed-once",
    });
    const again = await recordInboundMessage(db, {
      shopId: shop.id,
      channel: "email",
      fromAddress: DIVER.email,
      body: "C",
      receivedAt: now,
      providerMessageId: "replayed-once",
    });
    expect(first.status).toBe("recorded");
    expect(again.status).toBe("duplicate");
  });

  it("stops interpreting keywords once one address has sent too many", async () => {
    const { db, shop, bookingId, now } = await context();
    const provider = acceptingProvider();
    // Eleven messages inside the hour: the cap is what makes guessing a
    // six-character code cost an hour per ten attempts.
    let last = "";
    for (let index = 0; index < 11; index += 1) {
      last = await inbound(db, shop.id, "2345PQ", {
        receivedAt: new Date(now.getTime() + index * 1000),
      });
    }

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: last,
        now,
        provider,
      }),
    ).toBe("rate_limited");
    expect(await statusOf(db, bookingId)).toBe("booked");
  });
});

describe("handleInboundReplyKeyword — what it does", () => {
  it("names the departure and asks for a code before anything is cancelled", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    const provider = acceptingProvider();
    const messageId = await inbound(db, shop.id, "C", { receivedAt: now });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("awaiting_confirmation");
    expect(await statusOf(db, bookingId)).toBe("booked");
    const [body] = replyBodies(provider.sent);
    expect(body).toContain(trip.title);
    expect(body).toContain("Nothing has changed yet.");
    // The message is marked so the inbox can read a row whose body is "C".
    const [row] = await db
      .select({ keywordIntent: inboundMessages.keywordIntent })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, messageId));
    expect(row?.keywordIntent).toBe("cancel");
  });

  it("releases the seat on the code, and records the reply as DiveDay's own", async () => {
    const { db, shop, bookingId, personId, now } = await context();
    const provider = acceptingProvider();
    await handleInboundReplyKeyword(db, {
      shopId: shop.id,
      inboundMessageId: await inbound(db, shop.id, "C", { receivedAt: now }),
      now,
      provider,
    });
    const code = confirmationCode(
      { shopId: shop.id, bookingId, personId, channel: "email", toAddress: DIVER.email },
      now.getTime(),
    );
    const later = new Date(now.getTime() + 60_000);
    const confirmId = await inbound(db, shop.id, code, { receivedAt: later });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: confirmId,
        now: later,
        provider,
      }),
    ).toBe("cancelled");
    expect(await statusOf(db, bookingId)).toBe("cancelled");

    const replies = await db
      .select({ sentByPersonId: staffReplies.sentByPersonId })
      .from(staffReplies)
      .where(and(eq(staffReplies.shopId, shop.id), eq(staffReplies.personId, personId)));
    expect(replies).toHaveLength(2);
    // Nobody typed these, and the record says so rather than naming a colleague.
    expect(replies.every((reply) => reply.sentByPersonId === null)).toBe(true);
    const [confirmed] = await db
      .select({
        answeredAt: inboundMessages.answeredAt,
        keywordIntent: inboundMessages.keywordIntent,
      })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, confirmId));
    expect(confirmed?.keywordIntent).toBe("confirm");
    expect(confirmed?.answeredAt).not.toBeNull();
  });

  it("refuses a code that has aged past its two windows", async () => {
    const { db, shop, bookingId, personId, now } = await context();
    const provider = acceptingProvider();
    await handleInboundReplyKeyword(db, {
      shopId: shop.id,
      inboundMessageId: await inbound(db, shop.id, "C", { receivedAt: now }),
      now,
      provider,
    });
    const code = confirmationCode(
      { shopId: shop.id, bookingId, personId, channel: "email", toAddress: DIVER.email },
      now.getTime(),
    );
    // Two windows on: the pending `C` is still inside the lookup's own reach
    // (which is what makes this the code expiring rather than the request), and
    // the code's two signing windows have both rolled past.
    const later = new Date(now.getTime() + 2 * CONFIRMATION_WINDOW_MS);
    const confirmId = await inbound(db, shop.id, code, { receivedAt: later });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: confirmId,
        now: later,
        provider,
      }),
    ).toBe("code_mismatch");
    expect(await statusOf(db, bookingId)).toBe("booked");
  });

  it("hands `M` to a person and leaves the message on the worklist", async () => {
    const { db, shop, bookingId, now } = await context();
    const provider = acceptingProvider();
    const messageId = await inbound(db, shop.id, "M", { receivedAt: now });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("handed_off");
    expect(await statusOf(db, bookingId)).toBe("booked");
    const [row] = await db
      .select({
        answeredAt: inboundMessages.answeredAt,
        keywordIntent: inboundMessages.keywordIntent,
      })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, messageId));
    expect(row?.keywordIntent).toBe("move");
    expect(row?.answeredAt).toBeNull();
  });

  it("never reaches a departure the shop took off the board", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    const provider = acceptingProvider();
    await db.update(trips).set({ deletedAt: now }).where(eq(trips.id, trip.id));
    const messageId = await inbound(db, shop.id, "C", { receivedAt: now });

    expect(
      await handleInboundReplyKeyword(db, {
        shopId: shop.id,
        inboundMessageId: messageId,
        now,
        provider,
      }),
    ).toBe("nothing_to_cancel");
    expect(await statusOf(db, bookingId)).toBe("booked");
  });
});
