import { z } from "zod";

/**
 * SMS and WhatsApp delivery through Twilio, fetch-based with no SDK — the same
 * seam shape as the Resend email provider (`./index.ts`) and the Stripe
 * providers under `../payments`. Every send degrades to `not_configured` when
 * the channel's credentials or sender are absent, so booking and reminder flows
 * stay testable and shippable without a texting account (docs ADR
 * 20260721-sms-whatsapp-notifications).
 */

export type SmsChannel = "sms" | "whatsapp";

export type SmsMessage = {
  channel: SmsChannel;
  /** Recipient in E.164 form, e.g. +13055551234 (no `whatsapp:` prefix). */
  to: string;
  /** Plain-text body; keep it short — one SMS segment where possible. */
  body: string;
};

export type SmsDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export interface SmsProvider {
  send(message: SmsMessage): Promise<SmsDelivery>;
}

type Fetch = typeof fetch;
type SmsEnvironment = Readonly<Record<string, string | undefined>>;

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * The E.164 number to text, or null when the stored phone can't be dialed
 * internationally. Strips spaces, dashes, dots, and parentheses first, but does
 * *not* guess a country code — a local "555-1234" has no unambiguous +country,
 * so callers skip SMS rather than text the wrong number.
 */
export function smsRecipient(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s().-]/g, "");
  return E164.test(cleaned) ? cleaned : null;
}

const twilioConfigSchema = z.object({
  accountSid: z.string().trim().min(1),
  authToken: z.string().trim().min(1),
  smsFrom: z.string().trim().min(1).optional(),
  whatsappFrom: z.string().trim().min(1).optional(),
});

type TwilioConfig = z.infer<typeof twilioConfigSchema>;

const twilioResponseSchema = z.object({ sid: z.string().min(1) });

export function twilioSmsProvider(config: TwilioConfig, fetchImpl: Fetch): SmsProvider {
  return {
    async send(message) {
      // A channel is only live when its sender is set: a shop may have SMS but
      // not WhatsApp, or the reverse. Missing sender → not_configured, never a
      // send to a blank From.
      const sender = message.channel === "whatsapp" ? config.whatsappFrom : config.smsFrom;
      if (!sender) return { status: "not_configured" };
      const prefix = message.channel === "whatsapp" ? "whatsapp:" : "";
      const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
      try {
        const response = await fetchImpl(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
            config.accountSid,
          )}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: `${prefix}${message.to}`,
              From: `${prefix}${sender}`,
              Body: message.body,
            }).toString(),
          },
        );
        if (!response.ok) return { status: "failed" };
        const body = twilioResponseSchema.safeParse(await response.json());
        return body.success
          ? { status: "sent", providerMessageId: body.data.sid }
          : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledSmsProvider: SmsProvider = {
  async send() {
    return { status: "not_configured" };
  },
};

/** The only application entry point for an outbound text. */
export async function notifySms(
  message: SmsMessage,
  provider = smsProviderFromEnvironment(),
): Promise<SmsDelivery> {
  return provider.send(message);
}

export function smsProviderFromEnvironment(
  env: SmsEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): SmsProvider {
  const config = twilioConfigSchema.safeParse({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    smsFrom: env.TWILIO_SMS_FROM,
    whatsappFrom: env.TWILIO_WHATSAPP_FROM,
  });
  return config.success ? twilioSmsProvider(config.data, fetchImpl) : disabledSmsProvider;
}
