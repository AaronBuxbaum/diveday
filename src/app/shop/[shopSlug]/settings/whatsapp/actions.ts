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
import { nowDate } from "@/lib/clock";
import { whatsAppRecipient } from "@/lib/notifications/whatsapp";
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
  | "disconnected"
  | "tested"
  | "test_failed"
  | "invalid"
  | "not_authorized"
  | "no_account"
  | "encryption_key_unset"
  | "encryption_key_invalid";

const connectSchema = z.object({
  // Meta's phone number id is a numeric string; anything else is a paste of the
  // wrong field (the display number, or the WABA id) and is worth catching here
  // rather than as a puzzling 400 from Graph later.
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/),
  accessToken: z.string().trim().min(20).max(1_000),
  templateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/),
  templateLanguage: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/),
  displayPhoneNumber: z.string().trim().max(40).optional(),
  wabaId: z.string().trim().max(64).optional(),
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

export async function connectWhatsAppAction(formData: FormData): Promise<void> {
  const { shopId, personId, path } = await settingsPath();
  const db = await getDb();
  if (!(await canPersonManageMessagingSettings(db, shopId, personId))) {
    done(path, "not_authorized");
  }

  const parsed = connectSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId") ?? "",
    accessToken: formData.get("accessToken") ?? "",
    templateName: formData.get("templateName") ?? "",
    templateLanguage: formData.get("templateLanguage") ?? "",
    displayPhoneNumber: formData.get("displayPhoneNumber") ?? undefined,
    wabaId: formData.get("wabaId") ?? undefined,
  });
  if (!parsed.success) done(path, "invalid");

  const result = await connectShopWhatsAppAccount(db, { shopId, ...parsed.data });
  if (result.status === "refused") done(path, result.reason);
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
  const delivery = await provider.send({
    to: parsed.data.testPhone,
    shopName: shop?.name ?? "DiveDay",
    // Deliberately shaped like a real courtesy message rather than the word
    // "test": it proves the same template, the same two variables, and the same
    // parameter sanitising that a live reminder will use.
    body: "This is a test message from DiveDay. Your WhatsApp connection is working.",
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
