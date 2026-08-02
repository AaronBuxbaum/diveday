import { log } from "@/lib/log";

/**
 * The courtesy text channel: the short message that rides alongside a trip
 * reminder or recap email, and *becomes* the tracked channel for a diver who
 * gave a phone number but no email (`src/db/reminders.ts`, `src/db/recap.ts`).
 *
 * There are two ways to deliver it and they are not interchangeable:
 *
 * - **SMS via AWS SNS** — DiveDay's own account, one platform-wide credential,
 *   works for any phone number on earth (ADR 20260802-sns-sms-adapter).
 * - **WhatsApp via Meta's Cloud API** — the *shop's own* WhatsApp Business
 *   account, so the diver sees the dive shop they booked with rather than an
 *   unknown short code (ADR 20260802-whatsapp-cloud-api-per-shop).
 *
 * This module owns the one rule that decides between them, so `reminders.ts`
 * and `recap.ts` don't each grow their own copy of it.
 *
 * The types live here rather than in either adapter because both adapters
 * report the same outcomes, and a shared vocabulary is what lets
 * `recordNotificationDelivery` accept either one unchanged.
 */

export type CourtesyChannel = "sms" | "whatsapp";

/**
 * Deliberately the same shape as `NotificationDelivery` minus `retryAfterMs`
 * (neither text channel exposes a usable retry hint), so a courtesy result can
 * be recorded through the same seam as an email one.
 */
export type CourtesyDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | {
      status: "failed";
      retryable?: boolean;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

export type CourtesyMessage = {
  /** Recipient in E.164 form, e.g. +13055551234. Each adapter normalizes further. */
  to: string;
  /** Plain-text body; keep it short — one SMS segment where possible. */
  body: string;
  /** The shop the message is from; WhatsApp templates name it, SMS bodies already embed it. */
  shopName: string;
};

export interface CourtesyProvider {
  send(message: CourtesyMessage): Promise<CourtesyDelivery>;
}

/**
 * The SMS half, typed structurally rather than imported, so this module stays
 * free of a cycle with `./sms` (which takes its `SmsDelivery` from here).
 */
export interface PlainTextProvider {
  send(message: { to: string; body: string }): Promise<CourtesyDelivery>;
}

export type CourtesyResult = {
  /** Which channel produced `delivery` — what a staff surface should name. */
  channel: CourtesyChannel;
  delivery: CourtesyDelivery;
};

export type CourtesyProviders = {
  /** The shop's own WhatsApp sender, or null when it hasn't connected one. */
  whatsapp?: CourtesyProvider | null;
  sms: PlainTextProvider;
};

/**
 * Send one courtesy message, preferring the shop's own WhatsApp when it has
 * connected one and falling back to SMS otherwise.
 *
 * **Prefer, not both.** A shop that connected WhatsApp wants its divers reached
 * on WhatsApp; sending the identical text twice would double-message the diver
 * and pay for it twice.
 *
 * **Fall back on any non-`sent` WhatsApp outcome**, including a retryable one.
 * The overwhelmingly common failure here is the diver simply not being on
 * WhatsApp (Meta error 131026), and a trip reminder is worth little if it
 * arrives after the boat leaves — so a second channel now beats a retry later.
 * The WhatsApp failure is logged rather than returned, because the SMS result is
 * the one that describes what the diver actually got.
 *
 * The exception is a shop with WhatsApp connected and no SMS credentials at all:
 * there, `not_configured` from SMS would report "nothing is set up" about a
 * channel the shop *did* set up, so the WhatsApp failure is returned instead.
 */
export async function sendCourtesyMessage(
  message: CourtesyMessage,
  providers: CourtesyProviders,
): Promise<CourtesyResult> {
  const whatsAppDelivery = providers.whatsapp
    ? await providers.whatsapp.send(message)
    : { status: "not_configured" as const };
  if (whatsAppDelivery.status === "sent") {
    return { channel: "whatsapp", delivery: whatsAppDelivery };
  }
  if (whatsAppDelivery.status === "failed") {
    log("notification.whatsapp_fell_back_to_sms", "warn", {
      httpStatus: whatsAppDelivery.httpStatus,
      errorCode: whatsAppDelivery.errorCode,
      retryable: whatsAppDelivery.retryable,
    });
  }

  const smsDelivery = await providers.sms.send({ to: message.to, body: message.body });
  if (smsDelivery.status === "not_configured" && whatsAppDelivery.status === "failed") {
    return { channel: "whatsapp", delivery: whatsAppDelivery };
  }
  return { channel: "sms", delivery: smsDelivery };
}
