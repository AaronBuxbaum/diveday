"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type BookkeeperChange,
  issueBookkeeperConfirmation,
  setBookkeeper,
  tellOwnersAboutBookkeeper,
} from "@/db/bookkeeper";
import type { AppDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
import { sendNotification } from "@/db/notifications";
import { recordShopActivity } from "@/db/shop-activity";
import { toDiverLocale } from "@/i18n/settings";
import { bookkeeperAddress } from "@/lib/bookkeeper";
import { nowDate } from "@/lib/clock";
import { confirmContactLinkPath } from "@/lib/contact-email-confirmation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/** What the form says after a save; the words are the component's. */
export type BookkeeperFormState = {
  status:
    | "idle"
    | "saved"
    | "cleared"
    | "invalid"
    /** A confirm link went to the address; nothing is sent until it is used. */
    | "confirmation-sent"
    /** Saved, but the link could not go now (rate limit, no origin, a failed send). */
    | "confirmation-not-sent";
};

type SurfaceShop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/**
 * **The bookkeeper's address** (fifth loop, item 35; ADR
 * 20261016-bookkeeper-month-end-email). Setting it schedules a month of diver
 * names, crew names and money to leave the shop every month, so it takes the
 * month-end download's own gate: an owner or manager (`canPersonExportShopData`,
 * re-read from live roles) and the export step-up. The shop is the session's;
 * a slug naming another shop ends in `requireShopSurface`. An empty field
 * turns the email off.
 *
 * Every set, change and removal is a line in the activity log and an email to
 * every owner (security review F1), and a new address gets a confirm link
 * before anything is sent to it (B1). Saving an unconfirmed address again
 * sends the link again; saving any address again records the saver as the
 * person who stands behind it, and when that is someone new it is logged and
 * emailed too (`vouched`, second pass), since it can restart files held
 * because the old setter lost access.
 */
export async function saveBookkeeperAction(
  shopSlug: string,
  _previous: BookkeeperFormState,
  formData: FormData,
): Promise<BookkeeperFormState> {
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "reports-not-authorized" },
  });
  const reports = shopPath(shop.slug, "settings", "bookkeeper");
  if (!(await hasRequiredStepUp(db, session, "export"))) {
    redirect(stepUpChallengeUrl(shop.slug, "export", reports));
  }
  const raw = String(formData.get("email") ?? "");
  const email = raw.trim() === "" ? null : bookkeeperAddress(raw);
  if (raw.trim() !== "" && email === null) return { status: "invalid" };
  const now = nowDate();
  const saved = await setBookkeeper(db, {
    shopId: shop.id,
    timeZone: shop.timezone,
    personId: session.user.personId,
    email,
    now,
  });
  await reportChange(db, { shop, change: saved.change, email, actor: session.user, now });
  revalidatePath(reports);
  if (email === null) return { status: "cleared" };
  if (saved.confirmed || shop.isDemo) return { status: "saved" };
  const sent = await sendBookkeeperConfirmation(db, shop, email, now);
  return { status: sent ? "confirmation-sent" : "confirmation-not-sent" };
}

/** The log line and the owners' email for a save that changed the address or who stands behind it. */
async function reportChange(
  db: AppDb,
  input: {
    shop: SurfaceShop;
    change: BookkeeperChange;
    email: string | null;
    actor: { personId: string; name?: string | null };
    now: Date;
  },
) {
  const { shop, change, email, actor, now } = input;
  if (change === "none" || change === "resaved") return;
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: actor.personId,
    write: { code: `bookkeeper_email_${change}` },
  });
  const actorName = actor.name?.trim() || shop.name;
  await tellOwnersAboutBookkeeper(db, {
    shopId: shop.id,
    what:
      change === "cleared" || email === null
        ? { event: "cleared", actorName }
        : { event: change, email, actorName },
    at: now,
    actorPersonId: actor.personId,
  });
}

/**
 * Mints a confirm link for the address and sends it there, and nowhere else.
 * Rate-limited per shop, and per recipient in the front desk confirmation's
 * own bucket, as the shore contact's link is: a save-and-resend loop must not
 * be a branded-mail relay. A refused or failed send leaves the address saved
 * and unconfirmed, which sends nothing; saving it again tries again.
 */
async function sendBookkeeperConfirmation(
  db: AppDb,
  shop: SurfaceShop,
  email: string,
  now: Date,
): Promise<boolean> {
  const origin = publicAppUrl();
  if (!origin) return false;
  const [byShop, byRecipient] = await Promise.all([
    checkRateLimit(
      rateLimitKey("bookkeeper-confirmation", "shop", shop.id),
      RATE_LIMITS.contactConfirmationByShop,
    ),
    checkRateLimit(
      rateLimitKey("contact-confirmation", "recipient", email.toLowerCase()),
      RATE_LIMITS.contactConfirmationByRecipient,
    ),
  ]);
  if (!byShop.allowed || !byRecipient.allowed) return false;
  const issued = await issueBookkeeperConfirmation(db, { shopId: shop.id, email, now });
  if (!issued) return false;
  const delivery = await sendNotification(db, {
    kind: "bookkeeper_confirmation",
    shopId: shop.id,
    to: email,
    locale: toDiverLocale(shop.defaultLocale),
    shopName: shop.name,
    confirmUrl: new URL(confirmContactLinkPath(issued.token), `${origin}/`).toString(),
    expiresAt: issued.expiresAt,
    timezone: shop.timezone,
  });
  return delivery.status === "sent";
}
