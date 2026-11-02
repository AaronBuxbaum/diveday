"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { recordShopActivity } from "@/db/shop-activity";
import { getShopById, setShopEmergencyReference, setShopShoreAlertContact } from "@/db/shops";
import { issueShoreAlertConfirmation } from "@/db/shore-alert-tokens";
import { toDiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { confirmContactLinkPath } from "@/lib/contact-email-confirmation";
import { MAX_EMERGENCY_LINES, normalizeEmergencyReference } from "@/lib/emergency-reference";
import { checkbox, readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireStaffSession } from "@/lib/session";
import { nextShoreAlertContact } from "@/lib/shore-alert-contact";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "./action-helpers";

/**
 * The reference's fixed lines, the shore contact's alert address and its
 * consent box (H-20261014-stale-roll-call-recipients), plus a numbered label and phone per contact on the
 * catch-all.
 */
const emergencyForm = z
  .object({
    emergencyVessel: text(),
    emergencyShoreContact: text(),
    emergencyPlan: text(),
    shoreAlertEmail: text(),
    shoreAlertConsent: checkbox(),
    /** The address the box was drawn ticked for; "" when it was drawn empty. */
    shoreAlertConsentFor: text(),
  })
  .catchall(text());

/**
 * **The numbers a crew dials during** — chamber, dive-accident hotline,
 * coastguard, vessel, shore contact and the shop's own plan (issue #688).
 *
 * Free text throughout, and DiveDay validates only that a line has something to
 * dial. The nearest chamber differs by dock and the hotline differs by country,
 * so any shape this imposed would be wrong somewhere — and a wrong number on
 * the one screen a crew reads offshore is worse than an empty one.
 *
 * The one exception is the shore contact's alert address (H-20261014-stale-roll-call-recipients), which
 * DiveDay sends to: it must be an address, and it saves only with the box
 * that records the shore contact agreed to hear, drawn for that address
 * (`shoreAlertConsentFor`; a changed address never inherits the old tick).
 * Either refusal saves nothing, so the reference and the address never
 * half-land. A new or changed address is sent a link to confirm it before any
 * alert goes (`sendShoreAlertConfirmation`); a demo shop sends nothing.
 */
export async function saveEmergencyReferenceAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "emergency-reference");
  await settingsBlock(session);
  const form = readForm(emergencyForm, formData);
  const db = await getDb();
  const current = await getShopById(db, session.user.shopId);
  const shore = nextShoreAlertContact({
    current: {
      email: current?.shoreAlertEmail ?? null,
      consentAt: current?.shoreAlertConsentAt ?? null,
      consentByPersonId: current?.shoreAlertConsentByPersonId ?? null,
      confirmedAt: current?.shoreAlertConfirmedAt ?? null,
    },
    email: form.shoreAlertEmail,
    consented: form.shoreAlertConsent,
    consentFor: form.shoreAlertConsentFor,
    actorPersonId: session.user.personId,
    now: nowDate(),
  });
  if (!shore.ok) {
    redirect(
      noticeUrl(
        page,
        shore.reason === "invalid_email" ? "shore-alert-invalid" : "shore-alert-consent-missing",
      ),
    );
  }
  const reference = normalizeEmergencyReference({
    lines: Array.from({ length: MAX_EMERGENCY_LINES }, (_, index) => ({
      label: (form[`emergencyLabel-${index}`] ?? "").slice(0, 80),
      phone: (form[`emergencyPhone-${index}`] ?? "").slice(0, 40),
    })),
    vessel: form.emergencyVessel.slice(0, 120),
    shoreContact: form.emergencyShoreContact.slice(0, 160),
    plan: form.emergencyPlan.slice(0, 2000),
  });
  const shop = await setShopEmergencyReference(db, session.user.shopId, reference);
  // An unchanged address is left alone rather than written back: a write of
  // what this request read would undo a confirmation that landed meanwhile.
  if (shore.change === "unchanged") revalidateAndRedirect(page, noticeUrl(page, "emergency-saved"));

  await setShopShoreAlertContact(db, session.user.shopId, shore.value);
  await recordShopActivity(db, {
    shopId: session.user.shopId,
    actorPersonId: session.user.personId,
    write: { code: `shore_alert_contact_${shore.change}` },
  });
  if (shore.change === "cleared") {
    revalidateAndRedirect(page, noticeUrl(page, "shore-alert-cleared"));
  }
  const named = shop ?? current;
  const notice = await confirmationNotice(
    named ? { ...named, shoreAlertEmail: shore.value.email } : null,
  );
  revalidateAndRedirect(page, noticeUrl(page, notice));
}

/** "Send the link again" under an address still waiting for its confirmation. */
export async function resendShoreAlertConfirmationAction() {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "emergency-reference");
  await settingsBlock(session);
  const shop = await getShopById(await getDb(), session.user.shopId);
  if (!shop?.shoreAlertEmail || shop.shoreAlertConfirmedAt) {
    revalidateAndRedirect(page, noticeUrl(page, "emergency-saved"));
  }
  const notice = await confirmationNotice(shop);
  revalidateAndRedirect(page, noticeUrl(page, notice));
}

/** Sends the confirmation link when it may, and names the notice that says what happened. */
async function confirmationNotice(
  shop: {
    id: string;
    name: string;
    isDemo: boolean;
    defaultLocale: string;
    timezone: string;
    shoreAlertEmail: string | null;
  } | null,
) {
  if (!shop?.shoreAlertEmail) return "emergency-saved";
  // A demo shop's owner login is anybody's: it sends nothing, the link included.
  if (shop.isDemo) return "shore-alert-saved-demo";
  const sent = await sendShoreAlertConfirmation({ ...shop, shoreAlertEmail: shop.shoreAlertEmail });
  return sent ? "shore-alert-confirmation-sent" : "shore-alert-confirmation-not-sent";
}

/**
 * Mints a confirmation link for the shop's shore address and sends it there,
 * and nowhere else (H-20261014-stale-roll-call-recipients security review). Rate-limited per shop, and per
 * recipient in the front desk confirmation's own bucket (issue #1288), so one
 * inbox has one hourly allowance whichever link the shop sends it (security
 * re-review #4): without them a save-and-resend loop is a branded-mail relay
 * to anybody's inbox. A refused or failed send leaves the address saved and
 * unconfirmed, which sends nothing; the resend control is still there.
 */
async function sendShoreAlertConfirmation(shop: {
  id: string;
  name: string;
  defaultLocale: string;
  timezone: string;
  shoreAlertEmail: string;
}): Promise<boolean> {
  const origin = publicAppUrl();
  if (!origin) return false;
  const [byShop, byRecipient] = await Promise.all([
    checkRateLimit(
      rateLimitKey("shore-alert-confirmation", "shop", shop.id),
      RATE_LIMITS.contactConfirmationByShop,
    ),
    checkRateLimit(
      rateLimitKey("contact-confirmation", "recipient", shop.shoreAlertEmail.toLowerCase()),
      RATE_LIMITS.contactConfirmationByRecipient,
    ),
  ]);
  if (!byShop.allowed || !byRecipient.allowed) return false;
  const db = await getDb();
  const issued = await issueShoreAlertConfirmation(db, {
    shopId: shop.id,
    email: shop.shoreAlertEmail,
  });
  const delivery = await sendNotification(db, {
    kind: "address_confirmation",
    purpose: "shore_alert",
    shopId: shop.id,
    tokenId: issued.tokenId,
    to: shop.shoreAlertEmail,
    locale: toDiverLocale(shop.defaultLocale),
    shopName: shop.name,
    confirmUrl: new URL(confirmContactLinkPath(issued.token), `${origin}/`).toString(),
    expiresAt: issued.expiresAt,
    timezone: shop.timezone,
  });
  return delivery.status === "sent";
}
