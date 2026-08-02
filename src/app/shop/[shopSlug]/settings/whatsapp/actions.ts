"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageMessagingSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  connectShopWhatsAppAccount,
  disconnectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  markShopWhatsAppVerified,
  whatsAppProviderForAccount,
} from "@/db/whatsapp-accounts";
import { diverTranslator } from "@/i18n/messages";
import { toDiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import {
  DEFAULT_WHATSAPP_TEMPLATE_NAME,
  metaLanguageCode,
  whatsAppRecipient,
} from "@/lib/notifications/whatsapp";
import {
  completeEmbeddedSignup,
  generateRegistrationPin,
  whatsAppSignupConfigFromEnvironment,
} from "@/lib/notifications/whatsapp-signup";
import { requireStaffSession } from "@/lib/session";

/**
 * Connect, test, and disconnect a shop's own WhatsApp Business sender (docs ADR
 * 20260802-whatsapp-cloud-api-per-shop).
 *
 * Two rules run through all three actions. The gate is re-checked against live
 * roles on every mutation, never inferred from the page having rendered — a
 * demoted manager loses this surface immediately. And the access token travels
 * one way only: in through the form, sealed straight into the row, and never
 * back out to a response, a redirect parameter, or a log line.
 */

/** Notices are codes; `page.tsx` picks the words (ADR 20260731-domain-layer-copy-leaks). */
type Notice =
  | "connected"
  | "signup_unavailable"
  | "signup_failed_exchange"
  | "signup_failed_register"
  | "signup_failed_subscribe"
  | "signup_failed_template"
  | "disconnected"
  | "tested"
  | "test_failed"
  | "invalid"
  | "not_authorized"
  | "no_account"
  | "encryption_key_unset"
  | "encryption_key_invalid";

/**
 * What Meta's Embedded Signup popup hands back. All three are opaque ids from
 * Meta, not shop input — validated only for shape, because a value that is not
 * one of these will simply fail the exchange a moment later.
 */
const signupSchema = z.object({
  code: z.string().trim().min(10).max(2_000),
  wabaId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/),
});

const testSchema = z.object({
  testPhone: z.string().trim().min(1).max(40),
});

async function settingsPath(): Promise<{ shopId: string; personId: string; path: string }> {
  const session = await requireStaffSession();
  return {
    shopId: session.user.shopId,
    personId: session.user.personId,
    path: `/shop/${session.user.shopSlug}/settings/whatsapp`,
  };
}

function done(path: string, notice: Notice): never {
  revalidatePath(path);
  redirect(`${path}?notice=${notice}`);
}

/**
 * Finish an Embedded Signup: exchange Meta's one-time code for the shop's
 * business token, register and subscribe the number, provision the courtesy
 * template, and store the result sealed.
 *
 * The shop never sees or types a credential — that is the whole point of moving
 * off the paste-your-own-token flow. The code is single-use and short-lived, so
 * a replayed submission fails at Meta rather than minting a second connection.
 */
export async function completeWhatsAppSignupAction(formData: FormData): Promise<void> {
  const { shopId, personId, path } = await settingsPath();
  const db = await getDb();
  if (!(await canPersonManageMessagingSettings(db, shopId, personId))) {
    done(path, "not_authorized");
  }

  const config = whatsAppSignupConfigFromEnvironment();
  if (!config) done(path, "signup_unavailable");

  const parsed = signupSchema.safeParse({
    code: formData.get("code") ?? "",
    wabaId: formData.get("wabaId") ?? "",
    phoneNumberId: formData.get("phoneNumberId") ?? "",
  });
  if (!parsed.success) done(path, "invalid");

  const shop = await getShopById(db, shopId);
  // The template is submitted in the shop's own diver-facing language, with its
  // words coming from the diver bundle — a diver is who eventually reads them.
  const templateLocale = toDiverLocale(shop?.defaultLocale);
  const templateLanguage = metaLanguageCode(templateLocale);
  const diverT = diverTranslator(templateLocale);

  // Register only a number DiveDay has not registered before. A stored row for
  // this same phone number id means registration already succeeded once, and
  // Meta binds a number to its first PIN — so re-registering with a fresh one
  // fails with a PIN mismatch and walks the number toward a guess lockout. Null
  // tells the signup flow to skip that step and leave the stored PIN alone.
  const existing = await getShopWhatsAppAccount(db, shopId);
  const alreadyRegistered = existing?.phoneNumberId === parsed.data.phoneNumberId;
  const registrationPin = alreadyRegistered ? null : generateRegistrationPin();

  const result = await completeEmbeddedSignup(
    {
      ...parsed.data,
      templateName: DEFAULT_WHATSAPP_TEMPLATE_NAME,
      templateLanguage,
      templateCopy: {
        body: diverT("notifications.whatsappTemplate.body"),
        exampleShopName: diverT("notifications.whatsappTemplate.exampleShopName"),
        exampleMessage: diverT("notifications.whatsappTemplate.exampleMessage"),
      },
      registrationPin,
    },
    config,
  );
  if (result.status === "failed") done(path, `signup_failed_${result.step}` as Notice);

  const stored = await connectShopWhatsAppAccount(db, {
    shopId,
    phoneNumberId: parsed.data.phoneNumberId,
    wabaId: parsed.data.wabaId,
    accessToken: result.accessToken,
    templateName: DEFAULT_WHATSAPP_TEMPLATE_NAME,
    templateLanguage,
    registrationPin,
  });
  if (stored.status === "refused") done(path, stored.reason);
  done(path, "connected");
}

/**
 * Send one real template message to a number the staff member controls.
 *
 * This exists because everything else about this connection is unverifiable
 * guesswork until a message actually lands: whether the token has the right
 * scope, whether the template cleared review, whether the language code matches
 * the approval. Saving credentials proves none of it, so a shop that only
 * "saved" has no idea whether divers will hear from them until a boat is
 * already booked.
 */
export async function testWhatsAppAction(formData: FormData): Promise<void> {
  const { shopId, personId, path } = await settingsPath();
  const db = await getDb();
  if (!(await canPersonManageMessagingSettings(db, shopId, personId))) {
    done(path, "not_authorized");
  }

  const parsed = testSchema.safeParse({ testPhone: formData.get("testPhone") ?? "" });
  if (!parsed.success) done(path, "invalid");
  // Rejected here rather than by Meta, so a mistyped local number reads as
  // "check the details" instead of a provider error the shop can't act on.
  if (!whatsAppRecipient(parsed.data.testPhone)) done(path, "invalid");

  const account = await getShopWhatsAppAccount(db, shopId);
  if (!account) done(path, "no_account");
  const provider = whatsAppProviderForAccount(account);
  if (!provider) done(path, "encryption_key_unset");

  const shop = await getShopById(db, shopId);
  // A real diver would read this if it were a live send, so like the template
  // body it comes from the diver bundle rather than being written here.
  const testBody = diverTranslator(toDiverLocale(shop?.defaultLocale))(
    "notifications.whatsappTemplate.testMessage",
  );
  const delivery = await provider.send({
    to: parsed.data.testPhone,
    shopName: shop?.name ?? "DiveDay",
    // Deliberately shaped like a real courtesy message rather than the word
    // "test": it proves the same template, the same two variables, and the same
    // parameter sanitising that a live reminder will use.
    body: testBody,
  });
  if (delivery.status !== "sent") done(path, "test_failed");

  await markShopWhatsAppVerified(db, shopId, nowDate());
  done(path, "tested");
}

export async function disconnectWhatsAppAction(): Promise<void> {
  const { shopId, personId, path } = await settingsPath();
  const db = await getDb();
  if (!(await canPersonManageMessagingSettings(db, shopId, personId))) {
    done(path, "not_authorized");
  }
  const removed = await disconnectShopWhatsAppAccount(db, shopId);
  done(path, removed ? "disconnected" : "no_account");
}
