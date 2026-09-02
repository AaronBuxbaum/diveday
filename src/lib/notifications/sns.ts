import { createVerify } from "node:crypto";
import { z } from "zod";
import { HOUR_MS, MINUTE_MS, nowMs } from "@/lib/clock";

/**
 * Verification for inbound Amazon SNS HTTP(S) notifications (ADR
 * 20260802-ses-adapter-and-webhook), hand-rolled because AWS's SDK signs
 * *outbound* API calls — verifying a message SNS sent *to* us is a different,
 * unrelated problem with no SDK helper. Fails closed: an untrusted cert host,
 * a signature mismatch, or a topic mismatch never reaches event handling.
 *
 * Two guardrails matter most here. First, `SigningCertURL` (and, for a
 * subscription confirmation, `SubscribeURL`) is checked against a strict
 * `sns.<region>.amazonaws.com` host pattern *before* it is ever fetched — an
 * attacker-supplied URL must never be dereferenced, or this becomes an SSRF
 * and a signature forgery in one move. Second, a correctly-signed message's
 * own `TopicArn` must match the one this app actually provisioned
 * (`SES_SNS_TOPIC_ARN`), so a validly-signed message from an unrelated SNS
 * topic elsewhere in the same AWS partition can't be replayed against this
 * endpoint. Third, the signed `Timestamp` has to be recent — see `MAX_AGE_MS`
 * — so a message captured off this app's own topic can't be replayed back at
 * it later either.
 */

type Fetch = typeof fetch;

/**
 * This endpoint is deliberately unauthenticated (a webhook has to be), so an
 * unbounded body read is a cheap way to pressure server memory before any
 * validation has even run. Real SNS/SES payloads are a few KB; a signing
 * certificate is smaller still. Both are read through this cap rather than a
 * bare `.text()`.
 */
const MAX_BODY_BYTES = 262_144; // 256 KiB

async function readTextWithLimit(
  body: ReadableStream<Uint8Array> | null,
  limitBytes: number,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/** Reads a `Request` body through the same size cap the SNS/SES machinery uses. */
export async function readWebhookPayload(request: Request): Promise<string | null> {
  return readTextWithLimit(request.body, MAX_BODY_BYTES);
}

const snsMessageSchema = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  SignatureVersion: z.string().min(1),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
  Subject: z.string().optional(),
  SubscribeURL: z.string().optional(),
  Token: z.string().optional(),
});

export type SnsMessage = z.infer<typeof snsMessageSchema>;

export type SnsVerification =
  | { status: "verified"; message: SnsMessage }
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "invalid_topic" }
  | { status: "stale" }
  | { status: "malformed" };

/**
 * AWS's own guidance for verifying an SNS message's signing certificate:
 * HTTPS only, and a hostname of exactly `sns.<region>.amazonaws.com` (or the
 * `.amazonaws.com.cn` partition). Used for both `SigningCertURL` and, on a
 * subscription handshake, `SubscribeURL` — neither is fetched unless it
 * matches.
 */
const TRUSTED_SNS_HOST = /^sns\.[a-z0-9-]{3,}\.amazonaws\.com(\.cn)?$/i;

function isTrustedSnsUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && TRUSTED_SNS_HOST.test(parsed.hostname);
}

/**
 * The exact canonical form AWS specifies: each field name and value on its
 * own line, in a fixed order that differs by message type, with the whole
 * string ending in a trailing newline.
 */
function stringToSign(message: SnsMessage): string {
  const lines: string[] = [];
  const field = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    lines.push(key, value);
  };
  if (message.Type === "Notification") {
    field("Message", message.Message);
    field("MessageId", message.MessageId);
    field("Subject", message.Subject);
    field("Timestamp", message.Timestamp);
    field("TopicArn", message.TopicArn);
    field("Type", message.Type);
  } else {
    field("Message", message.Message);
    field("MessageId", message.MessageId);
    field("SubscribeURL", message.SubscribeURL);
    field("Timestamp", message.Timestamp);
    field("Token", message.Token);
    field("TopicArn", message.TopicArn);
    field("Type", message.Type);
  }
  return `${lines.join("\n")}\n`;
}

/** SNS signs with SHA1withRSA (SignatureVersion "1") or SHA256withRSA ("2"). */
function verifyRsaSignature(
  signedContent: string,
  signatureBase64: string,
  certificatePem: string,
  signatureVersion: string,
): boolean {
  const algorithm = signatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    const verifier = createVerify(algorithm);
    verifier.update(signedContent, "utf8");
    verifier.end();
    return verifier.verify(certificatePem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

async function fetchSigningCertificate(url: string, fetchImpl: Fetch): Promise<string | null> {
  if (!isTrustedSnsUrl(url)) return null;
  try {
    // `redirect: "manual"` so a 3xx is never silently followed to a host this
    // module never validated — `isTrustedSnsUrl` only ever checked the URL
    // handed to it, not wherever a redirect might point next.
    const response = await fetchImpl(url, { redirect: "manual" });
    if (!response.ok) return null;
    const body = await readTextWithLimit(response.body, MAX_BODY_BYTES);
    return body?.trim() ? body : null;
  } catch {
    return null;
  }
}

/**
 * How old a signed SNS message may be before this endpoint stops believing it,
 * and how far into the future a clock skew may put it.
 *
 * The signature and the topic pin already say the message is genuine and
 * came from a topic this app provisioned; neither says it is *current*. Every
 * field SNS signs — `Timestamp` included — is fixed at publish time, so a
 * message captured off the wire stays valid forever unless something reads
 * that timestamp. It mattered little while a replay could only re-apply an
 * idempotent delivery status; it stops being harmless the moment an event
 * writes anything a person can later undo — a `Complaint` that opts an address
 * out of courtesy mail replayed months later re-opts-out a diver who has since
 * opted back in. Checked here, once, so every SNS-fed webhook inherits it
 * rather than each route remembering to (issue #1289).
 *
 * The window is deliberately generous against SNS's own retry behaviour —
 * it retries a failing endpoint with backoff for far longer than an hour, and
 * a message refused here is one this app has decided not to act on rather than
 * one it will get another chance at. An hour is long enough that an outage
 * and its recovery both fall inside it, and short enough that a captured
 * message is worthless by the time it could be used.
 *
 * `MAX_FUTURE_MS` exists only for clock skew between AWS and this host, so it
 * is small: a timestamp meaningfully in the future is not a slow message.
 */
const MAX_AGE_MS = HOUR_MS;
const MAX_FUTURE_MS = 5 * MINUTE_MS;

function isFresh(timestamp: string, now: number): boolean {
  const published = Date.parse(timestamp);
  if (Number.isNaN(published)) return false;
  const age = now - published;
  return age <= MAX_AGE_MS && age >= -MAX_FUTURE_MS;
}

/**
 * `expectedTopicArn` unset behaves exactly like an unset webhook secret
 * elsewhere in this app: the endpoint is unavailable (503) rather than
 * accepting messages it cannot actually scope to a topic.
 */
export async function verifySnsMessage(
  payload: string,
  expectedTopicArn: string | undefined,
  fetchImpl: Fetch = fetch,
): Promise<SnsVerification> {
  if (!expectedTopicArn) return { status: "not_configured" };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch {
    return { status: "malformed" };
  }
  const parsed = snsMessageSchema.safeParse(parsedJson);
  if (!parsed.success) return { status: "malformed" };
  const message = parsed.data;

  if (message.TopicArn !== expectedTopicArn) return { status: "invalid_topic" };

  // Before the certificate fetch, not after: a stale message is refused
  // without this module making an outbound request on its behalf.
  if (!isFresh(message.Timestamp, nowMs())) return { status: "stale" };

  const certificate = await fetchSigningCertificate(message.SigningCertURL, fetchImpl);
  if (!certificate) return { status: "invalid_signature" };

  const valid = verifyRsaSignature(
    stringToSign(message),
    message.Signature,
    certificate,
    message.SignatureVersion,
  );
  if (!valid) return { status: "invalid_signature" };

  return { status: "verified", message };
}

/**
 * Completes the one-time SNS subscription handshake: a `SubscriptionConfirmation`
 * message is only ever acted on after `verifySnsMessage` has already verified
 * it, and `SubscribeURL` is independently re-checked against the same trusted
 * host pattern before being fetched — belt and suspenders around the one place
 * this module makes an outbound request based on message content. Unlike the
 * `Notification` path, nothing here writes to this app's own database — the
 * only effect of replaying an old, genuinely-signed confirmation message is a
 * redundant subscribe/unsubscribe call against AWS's own endpoint.
 */
export async function confirmSnsSubscription(
  subscribeUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  if (!isTrustedSnsUrl(subscribeUrl)) return false;
  try {
    // See fetchSigningCertificate: never follow a redirect to an unvalidated host.
    const response = await fetchImpl(subscribeUrl, { redirect: "manual" });
    return response.ok;
  } catch {
    return false;
  }
}
