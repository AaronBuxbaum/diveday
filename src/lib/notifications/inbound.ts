import { z } from "zod";

/**
 * Fetching a received message's body (20260724-resend-webhook-email-events).
 *
 * The `email.received` webhook carries metadata only — sender, recipients,
 * subject — so the body is a second, authenticated call. That split is
 * deliberate on Resend's side (a large message would blow a serverless request
 * limit) and convenient on ours: the webhook can be verified, filed, and
 * answered even when the body fetch fails, leaving a reply that staff can see
 * arrived rather than one that vanished.
 */

const receivedEmailSchema = z.object({
  text: z.string().nullish(),
  html: z.string().nullish(),
});

export type ReceivedEmailBody = { text: string };

/**
 * Ceiling on the HTML part before conversion. Generously above the 20k of text
 * that survives ingest, since markup is most of what gets stripped.
 */
export const MAX_FETCHED_HTML_LENGTH = 200_000;

export interface InboundEmailFetcher {
  /** The message's plain-text body, or null when it can't be retrieved. */
  fetchBody(providerEmailId: string): Promise<ReceivedEmailBody | null>;
}

/**
 * A crude HTML-to-text fallback for senders that ship no plain-text part.
 *
 * Crude is the point: this is not sanitization and its output is never
 * rendered as markup. It exists so an HTML-only reply reads as *something* in
 * the inbox instead of as raw tags.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The bare address inside a header value — `"Ada Lovelace" <ada@example.com>`
 * and `ada@example.com` both reduce to `ada@example.com`. Returns null for
 * anything without a single `@`, so a malformed header never becomes a routing
 * key.
 */
export function emailAddressOf(rawValue: string): string | null {
  const angled = rawValue.match(/<([^<>]+)>/);
  const candidate = (angled?.[1] ?? rawValue).trim().toLowerCase();
  if (!candidate || candidate.includes(" ")) return null;
  const parts = candidate.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return candidate;
}

/** The display name on a From header, unquoted, or null when it carries none. */
export function senderNameOf(rawValue: string): string | null {
  const angled = rawValue.match(/^(.*)<[^<>]+>\s*$/);
  if (!angled) return null;
  const name = angled[1]
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return name || null;
}

type Fetch = typeof fetch;

export function resendInboundEmailFetcher(apiKey: string, fetchImpl: Fetch): InboundEmailFetcher {
  return {
    async fetchBody(providerEmailId) {
      try {
        const response = await fetchImpl(
          `https://api.resend.com/emails/receiving/${encodeURIComponent(providerEmailId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!response.ok) return null;
        const body = receivedEmailSchema.safeParse(await response.json());
        if (!body.success) return null;
        const text = body.data.text?.trim();
        if (text) return { text };
        const html = body.data.html?.trim();
        // Cut before converting, not after: `htmlToPlainText` runs half a dozen
        // global regexes, and a multi-megabyte HTML part would pay for all of
        // them only to have the result truncated anyway. The slice is loose
        // (markup shrinks under conversion) — `truncateInboundBody` at ingest
        // is what actually enforces the stored bound.
        return html
          ? { text: htmlToPlainText(html.slice(0, MAX_FETCHED_HTML_LENGTH)) }
          : { text: "" };
      } catch {
        return null;
      }
    },
  };
}

/** Null when no API key is configured — inbound then files metadata with an empty body. */
export function inboundEmailFetcherFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: Fetch = fetch,
): InboundEmailFetcher | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  return apiKey ? resendInboundEmailFetcher(apiKey, fetchImpl) : null;
}
