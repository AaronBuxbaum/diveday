import { z } from "zod";
import { DIVER_LOCALES, type DiverLocale } from "@/i18n/settings";
import { log } from "@/lib/log";
import type { CourtesyDelivery, CourtesyMessage, CourtesyProvider } from "./courtesy";

/**
 * WhatsApp delivery through **Meta's WhatsApp Cloud API**, using each shop's
 * own WhatsApp Business account (docs ADR 20260802-whatsapp-cloud-api-per-shop).
 *
 * Two things make this adapter shaped differently from the SNS/SES ones:
 *
 * 1. **Credentials are per shop, not per deployment.** DiveDay is not the
 *    sender — the dive shop is. So there is no `whatsAppProviderFromEnvironment`
 *    counterpart to `smsProviderFromEnvironment`; a provider is constructed from
 *    a row (`src/db/whatsapp-accounts.ts`) and there are as many live senders as
 *    there are connected shops.
 * 2. **Business-initiated messages must be templates.** WhatsApp only allows
 *    free-form text inside a 24-hour window opened by the *diver* messaging the
 *    shop first. A trip reminder is business-initiated by definition, so every
 *    send here is a pre-approved template — never raw text, no matter how short.
 *
 * Plain `fetch` rather than an SDK: this is an ordinary bearer-token REST call
 * with none of the SigV4 signing that earned the AWS clients their exception to
 * the house style.
 */

/**
 * Pinned rather than floating: Meta versions the Graph API and silently changes
 * behaviour between versions, so an upgrade should be a visible diff with the
 * runbook's compatibility note next to it, not something that happens on its own.
 */
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_ORIGIN = "https://graph.facebook.com";

/** WhatsApp's own cap on a single template body parameter. */
const MAX_PARAMETER_LENGTH = 1024;

export type WhatsAppCredentials = {
  /** Meta's id for the shop's sending number — the path segment of the send endpoint. */
  phoneNumberId: string;
  /** A Meta access token that can send as that number. Sealed at rest; plaintext only here. */
  accessToken: string;
  /** The approved template this shop sends courtesy messages through. */
  templateName: string;
  /** Meta language code of that template, e.g. `en_US`. */
  templateLanguage: string;
};

export type WhatsAppProviderOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
};

/**
 * Meta's language codes are not BCP-47: it wants `en_US`/`es_ES` (underscore).
 * Each diver locale DiveDay carries maps to exactly one, which is what lets the
 * settings form prefill a shop's template language from the locale it already
 * chose, and offer the rest as options.
 *
 * Note what this does *not* do: pick a language per recipient. A WhatsApp
 * template exists only in the languages the **shop** got approved, and DiveDay
 * cannot know which those are — sending a diver's own locale to a shop that
 * only approved English fails the send outright. So the shop's one stored
 * `templateLanguage` is used for every recipient, and the per-person locale
 * that governs email (ADR 20260731-per-person-notification-locale) governs the
 * message *body* here, not the template wrapper around it. A shop serving two
 * languages is better served by SMS until Meta's approval story gets cheaper.
 */
const META_LANGUAGE_BY_LOCALE: Record<DiverLocale, string> = {
  "en-US": "en_US",
  "es-ES": "es_ES",
};

export function metaLanguageCode(locale: DiverLocale): string {
  return META_LANGUAGE_BY_LOCALE[locale];
}

/** The Meta language codes a shop could have templates approved in, for the settings form. */
export const META_TEMPLATE_LANGUAGES = DIVER_LOCALES.map(metaLanguageCode);

/**
 * The default template name DiveDay documents for shops to create in their own
 * WhatsApp Manager. Stored per shop (not hard-coded at the call site) because a
 * shop whose approval went through under a different name must still work.
 */
export const DEFAULT_WHATSAPP_TEMPLATE_NAME = "diveday_courtesy_update";

/**
 * The recipient as Meta wants it: digits only, no `+`, no separators. Null when
 * the stored phone can't be dialed internationally — the same rule and the same
 * reason as `smsRecipient`: a local "555-1234" has no unambiguous country code,
 * so the message is skipped rather than sent to the wrong person.
 */
export function whatsAppRecipient(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(cleaned) ? cleaned.slice(1) : null;
}

/**
 * A string made safe to pass as a template variable. Meta rejects any parameter
 * containing a newline, a tab, or more than four consecutive spaces — so a body
 * that renders fine as an SMS would fail the whole send. Every whitespace run
 * collapses to one space, and the result is capped at Meta's own parameter
 * limit.
 */
export function templateParameter(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_PARAMETER_LENGTH
    ? `${collapsed.slice(0, MAX_PARAMETER_LENGTH - 1).trimEnd()}…`
    : collapsed;
}

const sendResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
  }),
});

type WhatsAppErrorInfo = {
  retryable: boolean;
  httpStatus?: number;
  errorCode?: string;
  detail?: string;
};

/**
 * Meta reports the useful part in `error.code`, and the HTTP status carries the
 * same retryable/non-retryable split every other adapter here classifies on
 * (429 and 5xx retryable, a request that never got a response retryable,
 * everything else not). That status-based rule already lands the Meta-specific
 * cases correctly — an expired token (190), an unapproved template (132001),
 * and a number not on WhatsApp (131026) are all 400-class and all genuinely
 * not worth retrying — so no per-code table is maintained here.
 */
function errorInfoFromResponse(status: number, rawBody: string): WhatsAppErrorInfo {
  const parsed = errorResponseSchema.safeParse(safeJson(rawBody));
  const error = parsed.success ? parsed.data.error : undefined;
  const code = error?.code;
  const subcode = error?.error_subcode;
  return {
    retryable: status === 429 || status >= 500,
    httpStatus: status,
    errorCode:
      code === undefined ? undefined : subcode === undefined ? `${code}` : `${code}/${subcode}`,
    detail: error?.message?.slice(0, 500),
  };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(4_000, 250 * 2 ** (attempt - 1));
  return base + Math.floor(random() * base);
}

/**
 * A WhatsApp sender for one shop's connected account.
 *
 * The message body is passed as the template's second variable, with the shop
 * name as the first — so a single approved template
 * (`Hi! An update from {{1}}: {{2}}`) carries every courtesy message DiveDay
 * sends. One template per shop to get approved rather than one per notification
 * kind is the difference between a shop switching this on in an afternoon and
 * abandoning it midway through Meta's review queue.
 */
export function whatsAppProvider(
  credentials: WhatsAppCredentials,
  fetchImpl: typeof fetch = fetch,
  providerOptions: WhatsAppProviderOptions = {},
): CourtesyProvider {
  const options = {
    sleep: providerOptions.sleep ?? sleep,
    random: providerOptions.random ?? Math.random,
    maxAttempts: providerOptions.maxAttempts ?? 3,
  };
  const endpoint = `${GRAPH_API_ORIGIN}/${GRAPH_API_VERSION}/${encodeURIComponent(
    credentials.phoneNumberId,
  )}/messages`;

  return {
    async send(message: CourtesyMessage): Promise<CourtesyDelivery> {
      const to = whatsAppRecipient(message.to);
      if (!to) {
        return { status: "failed", retryable: false, errorCode: "invalid_recipient" };
      }
      const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: credentials.templateName,
          language: { code: credentials.templateLanguage },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: templateParameter(message.shopName) },
                { type: "text", text: templateParameter(message.body) },
              ],
            },
          ],
        },
      };

      for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
        let info: WhatsAppErrorInfo;
        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${credentials.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const rawBody = await response.text();
          if (response.ok) {
            const parsed = sendResponseSchema.safeParse(safeJson(rawBody));
            if (!parsed.success) {
              return { status: "failed", retryable: true, errorCode: "invalid_response" };
            }
            return { status: "sent", providerMessageId: parsed.data.messages[0].id };
          }
          info = errorInfoFromResponse(response.status, rawBody);
        } catch (error) {
          info = {
            retryable: true,
            errorCode: "network_error",
            detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
          };
        }
        if (info.retryable && attempt < options.maxAttempts) {
          await options.sleep(retryDelayMs(attempt, options.random));
          continue;
        }
        // Never log the body or the recipient — a courtesy message names a
        // diver and their trip, and this line goes wherever logs go.
        log("notification.whatsapp_send_failed", "warn", {
          httpStatus: info.httpStatus,
          errorCode: info.errorCode,
          retryable: info.retryable,
        });
        return { status: "failed", ...info };
      }
      return { status: "failed", retryable: true, errorCode: "retry_exhausted" };
    },
  };
}
