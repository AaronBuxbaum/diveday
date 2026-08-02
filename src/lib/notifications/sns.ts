import { createVerify } from "node:crypto";
import { z } from "zod";

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
 * endpoint.
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
  Timestamp: z.string().min(1),
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
