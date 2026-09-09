import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordInboundMessage } from "@/db/inbound-messages";
import { handleInboundReplyKeyword } from "@/db/reply-keywords";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * **Delivers one inbound message as if a provider had** (ADR
 * 20260909-reply-keywords), so a spec can walk the reply-keyword flow the way
 * a diver does.
 *
 * There is no other door. The two real inbound webhooks verify a provider
 * signature — SNS over `EMAIL_INBOUND_SNS_TOPIC_ARN` for mail, Meta's app
 * secret for WhatsApp — and the Playwright fleet blanks every provider
 * credential, so neither can be exercised from a spec at all. This is the same
 * argument `seed-changed-dive-site` and `seed-returning-diver` make one table
 * over.
 *
 * It grants a spec nothing a webhook does not already grant its provider: the
 * shop is resolved from a slug, the sender must be a **live diver on that
 * shop's roster** (the route looks the address up itself rather than taking an
 * id), and the message then goes through `recordInboundMessage` and
 * `handleInboundReplyKeyword` unchanged — the same two calls, in the same
 * order, that `/api/webhooks/email-inbound` makes. Gated identically to
 * `/api/test/reset`, so it can never be reachable in a real deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  /** The diver's own address on file — email, or the phone for a WhatsApp. */
  from: z.string().trim().min(1),
  channel: z.enum(["email", "whatsapp"]),
  body: z.string().min(1).max(2_000),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  // The sender has to be somebody this shop actually holds, for the same
  // reason a webhook only files an attributed message against a matched
  // record: this route must not be able to invent a diver.
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shop.id),
        isNull(people.deletedAt),
        parsed.data.channel === "email"
          ? eq(people.email, parsed.data.from.toLowerCase())
          : eq(people.phone, parsed.data.from),
      ),
    )
    .limit(1);
  if (!diver) return NextResponse.json({ error: "diver_not_found" }, { status: 404 });

  const received = await recordInboundMessage(db, {
    shopId: shop.id,
    channel: parsed.data.channel,
    fromAddress: parsed.data.from,
    body: parsed.data.body,
    receivedAt: nowDate(),
    providerMessageId: `e2e-${crypto.randomUUID()}`,
  });
  if (received.status !== "recorded") {
    return NextResponse.json({ error: received.status }, { status: 409 });
  }

  const outcome = await handleInboundReplyKeyword(db, {
    shopId: shop.id,
    inboundMessageId: received.id,
  });
  return NextResponse.json({ ok: true, outcome });
}
