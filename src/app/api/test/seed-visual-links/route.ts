import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  claimBookkeeperMonth,
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  setBookkeeper,
} from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { ownerLogins } from "@/db/owner-logins";
import { userAccounts, weeklyDigestSends } from "@/db/schema";
import { getShopBySlug, setShopShoreAlertContact } from "@/db/shops";
import { issueShoreAlertConfirmation, issueShoreAlertStopToken } from "@/db/shore-alert-tokens";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { BOOKKEEPER_CONFIRMATION_TTL_MS, bookkeeperMonthOnSet } from "@/lib/bookkeeper";
import { addMonths, monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { SHORE_ALERT_CONFIRMATION_TTL_MS } from "@/lib/shore-alert-contact";
import { digestWeeks } from "@/lib/weekly-digest";

const bodySchema = z
  .object({
    shopSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    family: z.enum([
      "shore-confirm",
      "shore-stop",
      "bookkeeper-confirm",
      "bookkeeper-stop",
      "digest",
    ]),
    state: z.enum(["active", "expired"]).default("active"),
  })
  .strict()
  .refine(({ family, state }) => state !== "expired" || family.endsWith("-confirm"));

/**
 * The consent and opt-out links that otherwise exist only inside email.
 * Uses the real setters, issuers and hashed claim format, then the capture
 * drives each real public page and action. Confined to a minted demo shop:
 * neither the shared fixture nor a real tenant can have settings changed.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.shopSlug === DEMO_SHOP_SLUG) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop?.isDemo) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  const [owner] = await ownerLogins(db, shop.id);
  if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 409 });
  const { family, state } = parsed.data;
  const now = nowDate();
  let token: string;

  if (family === "digest") {
    // The sender has no separate token issuer: its unsubscribe capability
    // belongs to this exact send claim. Seed that same persisted shape,
    // without sending mail or depending on whether this week's facts are quiet.
    token = createBearerToken();
    const [claim] = await db
      .insert(weeklyDigestSends)
      .values({
        shopId: shop.id,
        personId: owner.personId,
        weekOf: digestWeeks(now, shop.timezone).weekOf,
        unsubscribeTokenHash: hashBearerToken(token),
        status: "sent",
      })
      .onConflictDoNothing()
      .returning({ id: weeklyDigestSends.id });
    if (!claim) return NextResponse.json({ error: "digest_already_seeded" }, { status: 409 });
    await db
      .update(userAccounts)
      .set({ weeklyDigest: true })
      .where(eq(userAccounts.personId, owner.personId));
  } else if (family.startsWith("shore-")) {
    const email = "shore.audit@example.com";
    await setShopShoreAlertContact(db, shop.id, {
      email,
      consentAt: now,
      consentByPersonId: owner.personId,
      confirmedAt: family === "shore-stop" ? now : null,
    });
    if (family === "shore-stop") {
      token = await issueShoreAlertStopToken(db, { shopId: shop.id, email });
    } else {
      const issued = await issueShoreAlertConfirmation(db, {
        shopId: shop.id,
        email,
        now:
          state === "expired" ? new Date(now.getTime() - SHORE_ALERT_CONFIRMATION_TTL_MS - 1) : now,
      });
      token = issued.token;
    }
  } else {
    const email = "books.audit@example.com";
    // Clear first so a prior capture cannot leave this address confirmed.
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email: null,
      personId: owner.personId,
      now,
    });
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email,
      personId: owner.personId,
      now,
    });
    const issued = await issueBookkeeperConfirmation(db, {
      shopId: shop.id,
      email,
      now: state === "expired" ? new Date(now.getTime() - BOOKKEEPER_CONFIRMATION_TTL_MS - 1) : now,
    });
    if (!issued) throw new Error("Visual fixture could not issue its bookkeeper confirmation");
    token = issued.token;
    if (family === "bookkeeper-stop") {
      await consumeBookkeeperConfirmation(db, { token, now, origin: null });
      const previous = parseMonthKey(bookkeeperMonthOnSet(now, shop.timezone));
      if (!previous) throw new Error("Visual fixture has no bookkeeper month");
      const claim = await claimBookkeeperMonth(db, {
        shopId: shop.id,
        email,
        setByPersonId: owner.personId,
        month: monthKey(addMonths(previous, 1)),
      });
      if (!claim) throw new Error("Visual fixture could not claim its bookkeeper month");
      token = claim.stopToken;
    }
  }

  const prefix = family.endsWith("-confirm") ? "/confirm-contact" : "/unsubscribe";
  return NextResponse.json({ token, path: `${prefix}/${token}` });
}
