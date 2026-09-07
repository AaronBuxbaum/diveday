import type { DbExecutor } from "./client";
import { inboundMessages, type people, staffReplies } from "./schema";
import { hoursFromNow } from "./seed-clock";

/**
 * What the desk phone has heard (ADR 20260907-two-way-inbox): the messages
 * divers sent back that the inbox and the record thread render. Its own
 * scenario so a demo shows the surface rather than an empty state, and so
 * the four states the inbox distinguishes all have a row:
 *
 * - **an email from a diver on file, unanswered** — the ordinary case, and
 *   the one Today counts;
 * - **a WhatsApp from a diver on file, unanswered, inside the 24-hour
 *   window** — so the reply composer can send in free text;
 * - **an email thread already answered** — a message and the shop's reply,
 *   so the record shows both directions;
 * - **an email from an address nobody holds** — the "Unknown sender" row.
 *
 * Every instant is clock-anchored (`hoursFromNow`) so the WhatsApp window is
 * open at the frozen e2e instant and the ages read the same in every capture.
 * The prose is fixture text, what a diver typed, and exempt from the copy
 * guard the way `seed-date-requests.ts` is.
 */
export async function seedInbox(
  db: DbExecutor,
  shopId: string,
  customers: (typeof people.$inferSelect)[],
  /** The staffer whose name the answered thread carries. */
  repliedByPersonId: string,
): Promise<void> {
  const [priya, , lena, diego] = customers;
  if (!priya?.email || !lena?.email || !diego?.phone) {
    throw new Error("seed: the inbox scenario needs the first four demo divers");
  }

  // The answered thread first, so the reply can name the message it answers.
  const answeredAt = hoursFromNow(-46);
  const [lenaMessage] = await db
    .insert(inboundMessages)
    .values({
      shopId,
      personId: lena.id,
      channel: "email",
      fromAddress: lena.email.toLowerCase(),
      // i18n-exempt: fixture text — what a diver typed, stored verbatim
      subject: "Re: You're booked",
      // i18n-exempt: fixture text — what a diver typed, stored verbatim
      body: "Do you rent 5mm suits in a women's medium? The water was colder than I expected last time.",
      receivedAt: hoursFromNow(-48),
      readAt: answeredAt,
      answeredAt,
      providerMessageId: `seed-inbox-${shopId}-lena`,
    })
    .returning({ id: inboundMessages.id });

  await db.insert(staffReplies).values({
    shopId,
    personId: lena.id,
    inboundMessageId: lenaMessage?.id ?? null,
    channel: "email",
    toAddress: lena.email.toLowerCase(),
    // i18n-exempt: fixture text — what a staffer typed, stored verbatim
    body: "We do. I've put a women's medium aside under your name for Saturday.",
    locale: "en-US",
    sentByPersonId: repliedByPersonId,
    status: "sent",
    providerMessageId: `seed-reply-${shopId}-lena`,
    sentAt: answeredAt,
  });

  await db.insert(inboundMessages).values([
    {
      shopId,
      personId: priya.id,
      channel: "email",
      fromAddress: priya.email.toLowerCase(),
      // i18n-exempt: fixture text — what a diver typed, stored verbatim
      subject: "Re: Your Saturday departure",
      // i18n-exempt: fixture text — what a diver typed, stored verbatim
      body: "Hi! Could I switch to the afternoon boat on Saturday? My flight lands at nine and I don't want to hold everyone up.\n\nPriya",
      receivedAt: hoursFromNow(-3),
      providerMessageId: `seed-inbox-${shopId}-priya`,
    },
    {
      shopId,
      personId: diego.id,
      channel: "whatsapp",
      fromAddress: diego.phone.replace(/\D/g, ""),
      subject: null,
      // i18n-exempt: fixture text — what a diver typed, stored verbatim
      body: "Running about 15 min late, traffic on the causeway. Please don't leave without me 🙏",
      receivedAt: hoursFromNow(-1.5),
      providerMessageId: `seed-inbox-${shopId}-diego`,
    },
    {
      shopId,
      personId: null,
      channel: "email",
      fromAddress: "marta.keller@example.net",
      // i18n-exempt: fixture text — what a stranger typed, stored verbatim
      subject: "Night dives in October?",
      // i18n-exempt: fixture text — what a stranger typed, stored verbatim
      body: "Hello, do you run night dives in October? Two of us, both Advanced. Thanks, Marta",
      receivedAt: hoursFromNow(-26),
      providerMessageId: `seed-inbox-${shopId}-marta`,
    },
  ]);
}
