import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { confirmSnsSubscription, type SnsMessage, verifySnsMessage } from "./sns";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certificatePem = publicKey.export({ type: "spki", format: "pem" }) as string;
const trustedCertUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem";
const trustedSubscribeUrl =
  "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=t&Token=tok";
const topicArn = "arn:aws:sns:us-east-1:123456789012:diveday-ses-email-events";

/**
 * An independent reference implementation of AWS's documented string-to-sign
 * format (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html),
 * so these tests check conformance to the real spec rather than merely
 * mirroring whatever sns.ts happens to do internally.
 */
function referenceStringToSign(fields: Record<string, string | undefined>, keys: string[]): string {
  const lines: string[] = [];
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) continue;
    lines.push(key, value);
  }
  return `${lines.join("\n")}\n`;
}

function signedNotification(
  overrides: Partial<SnsMessage> & { messageBody?: string } = {},
): SnsMessage & Record<string, unknown> {
  const base = {
    Type: "Notification" as const,
    MessageId: "11111111-2222-3333-4444-555555555555",
    TopicArn: topicArn,
    Message: overrides.messageBody ?? JSON.stringify({ eventType: "Bounce" }),
    Timestamp: "2026-08-02T18:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL: trustedCertUrl,
    Subject: undefined as string | undefined,
    ...overrides,
  };
  const stringToSign = referenceStringToSign(base, [
    "Message",
    "MessageId",
    "Subject",
    "Timestamp",
    "TopicArn",
    "Type",
  ]);
  const algorithm = base.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const signer = createSign(algorithm);
  signer.update(stringToSign, "utf8");
  signer.end();
  const Signature = signer.sign(privateKey, "base64");
  return { ...base, Signature };
}

function certFetch(body = certificatePem, ok = true) {
  return vi
    .fn()
    .mockResolvedValue(new Response(ok ? body : "not found", { status: ok ? 200 : 404 }));
}

describe("verifySnsMessage", () => {
  it("is not_configured without an expected topic ARN", async () => {
    const message = signedNotification();
    const result = await verifySnsMessage(JSON.stringify(message), undefined, certFetch());
    expect(result).toEqual({ status: "not_configured" });
  });

  it("verifies a correctly signed Notification", async () => {
    const message = signedNotification();
    const fetchImpl = certFetch();
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, fetchImpl);
    expect(result.status).toBe("verified");
    expect(fetchImpl).toHaveBeenCalledWith(trustedCertUrl);
  });

  it("verifies SignatureVersion 2 (SHA-256) too", async () => {
    const message = signedNotification({ SignatureVersion: "2" });
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, certFetch());
    expect(result.status).toBe("verified");
  });

  it("rejects malformed JSON", async () => {
    const result = await verifySnsMessage("not json", topicArn, certFetch());
    expect(result).toEqual({ status: "malformed" });
  });

  it("rejects a message missing required fields", async () => {
    const result = await verifySnsMessage(
      JSON.stringify({ Type: "Notification" }),
      topicArn,
      certFetch(),
    );
    expect(result).toEqual({ status: "malformed" });
  });

  it("rejects a correctly signed message whose TopicArn doesn't match ours", async () => {
    const message = signedNotification({
      TopicArn: "arn:aws:sns:us-east-1:999999999999:some-other-topic",
    });
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, certFetch());
    expect(result).toEqual({ status: "invalid_topic" });
  });

  it("rejects a tampered payload even with a valid-looking signature", async () => {
    const message = signedNotification();
    const tampered = { ...message, Message: JSON.stringify({ eventType: "Delivery" }) };
    const result = await verifySnsMessage(JSON.stringify(tampered), topicArn, certFetch());
    expect(result).toEqual({ status: "invalid_signature" });
  });

  it("never fetches a SigningCertURL outside AWS's SNS host pattern", async () => {
    const message = signedNotification({
      SigningCertURL: "https://evil.example.com/fake-cert.pem",
    });
    const fetchImpl = certFetch();
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, fetchImpl);
    expect(result).toEqual({ status: "invalid_signature" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTPS SigningCertURL even on an otherwise-trusted host", async () => {
    const message = signedNotification({
      SigningCertURL: "http://sns.us-east-1.amazonaws.com/cert.pem",
    });
    const fetchImpl = certFetch();
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, fetchImpl);
    expect(result).toEqual({ status: "invalid_signature" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a SigningCertURL host that merely contains the trusted suffix", async () => {
    // e.g. "sns.us-east-1.amazonaws.com.evil.com" — a naive .includes()/.endsWith()
    // check would be fooled by this; the host must match exactly.
    const message = signedNotification({
      SigningCertURL: "https://sns.us-east-1.amazonaws.com.evil.com/cert.pem",
    });
    const fetchImpl = certFetch();
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, fetchImpl);
    expect(result).toEqual({ status: "invalid_signature" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a failed certificate fetch as an invalid signature", async () => {
    const message = signedNotification();
    const result = await verifySnsMessage(JSON.stringify(message), topicArn, certFetch("", false));
    expect(result).toEqual({ status: "invalid_signature" });
  });

  it("includes Subject in the signed content only when present", async () => {
    const withSubject = signedNotification({ Subject: "A subject line" });
    const result = await verifySnsMessage(JSON.stringify(withSubject), topicArn, certFetch());
    expect(result.status).toBe("verified");
  });
});

describe("confirmSnsSubscription", () => {
  it("fetches SubscribeURL and reports success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(confirmSnsSubscription(trustedSubscribeUrl, fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(trustedSubscribeUrl);
  });

  it("never fetches a SubscribeURL outside the trusted SNS host pattern", async () => {
    const fetchImpl = vi.fn();
    await expect(
      confirmSnsSubscription("https://evil.example.com/confirm", fetchImpl),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports failure when the confirmation request itself fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(confirmSnsSubscription(trustedSubscribeUrl, fetchImpl)).resolves.toBe(false);
  });
});
