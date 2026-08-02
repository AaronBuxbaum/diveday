import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseWhatsAppDeliveryEvents,
  verifyWhatsAppSignature,
  whatsAppChallengeResponse,
} from "./whatsapp-events";

const APP_SECRET = "diveday-meta-app-secret";
const NOW = new Date("2026-08-02T12:00:00.000Z");

function sign(payload: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

function statusPayload(statuses: unknown[]) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses } }],
      },
    ],
  });
}

describe("verifyWhatsAppSignature", () => {
  it("accepts a correctly signed payload", () => {
    const payload = statusPayload([]);
    expect(verifyWhatsAppSignature(payload, sign(payload), APP_SECRET)).toEqual({
      status: "verified",
    });
  });

  it("rejects a payload signed with a different secret", () => {
    const payload = statusPayload([]);
    expect(verifyWhatsAppSignature(payload, sign(payload, "wrong"), APP_SECRET)).toEqual({
      status: "invalid_signature",
    });
  });

  it("rejects a tampered body — the signature is over the exact bytes", () => {
    const payload = statusPayload([]);
    const signature = sign(payload);
    expect(verifyWhatsAppSignature(`${payload} `, signature, APP_SECRET)).toEqual({
      status: "invalid_signature",
    });
  });

  it("rejects a missing, unprefixed, or malformed signature header", () => {
    const payload = statusPayload([]);
    for (const header of [null, "", "deadbeef", "sha1=abc", "sha256=", "sha256=zzzz"]) {
      expect(verifyWhatsAppSignature(payload, header, APP_SECRET).status).toBe("invalid_signature");
    }
  });

  it("reports not_configured rather than accepting anything when no secret is set", () => {
    const payload = statusPayload([]);
    expect(verifyWhatsAppSignature(payload, sign(payload), undefined)).toEqual({
      status: "not_configured",
    });
  });
});

describe("whatsAppChallengeResponse", () => {
  const token = "verify-token-1";

  it("echoes the challenge for a correct token", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": "1158201444",
    });
    expect(whatsAppChallengeResponse(params, token)).toBe("1158201444");
  });

  it("refuses a wrong token, a wrong mode, or a missing challenge", () => {
    const base = {
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": "abc",
    };
    expect(
      whatsAppChallengeResponse(new URLSearchParams({ ...base, "hub.verify_token": "no" }), token),
    ).toBeNull();
    expect(
      whatsAppChallengeResponse(new URLSearchParams({ ...base, "hub.mode": "unsubscribe" }), token),
    ).toBeNull();
    const noChallenge = new URLSearchParams(base);
    noChallenge.delete("hub.challenge");
    expect(whatsAppChallengeResponse(noChallenge, token)).toBeNull();
  });

  it("refuses everything when no verify token is configured", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "anything",
      "hub.challenge": "abc",
    });
    expect(whatsAppChallengeResponse(params, undefined)).toBeNull();
  });
});

describe("parseWhatsAppDeliveryEvents", () => {
  it("maps sent, delivered, and failed onto the stored provider statuses", () => {
    const payload = statusPayload([
      { id: "wamid.1", status: "sent", timestamp: "1785672000" },
      { id: "wamid.2", status: "delivered", timestamp: "1785672060" },
      { id: "wamid.3", status: "failed", timestamp: "1785672120" },
    ]);

    const events = parseWhatsAppDeliveryEvents(payload, NOW);

    expect(events.map((event) => event.status)).toEqual(["sent", "delivered", "failed"]);
    expect(events[0].providerMessageId).toBe("wamid.1");
    expect(events[0].occurredAt).toEqual(new Date(1785672000 * 1000));
  });

  it("ignores read receipts — DiveDay does not record opens on any channel", () => {
    const payload = statusPayload([{ id: "wamid.1", status: "read", timestamp: "1785672000" }]);
    expect(parseWhatsAppDeliveryEvents(payload, NOW)).toEqual([]);
  });

  it("carries Meta's specific explanation for a failure", () => {
    const payload = statusPayload([
      {
        id: "wamid.1",
        status: "failed",
        timestamp: "1785672000",
        errors: [
          {
            code: 131026,
            title: "Message undeliverable",
            error_data: { details: "Receiver is not a valid WhatsApp user" },
          },
        ],
      },
    ]);

    expect(parseWhatsAppDeliveryEvents(payload, NOW)[0].detail).toBe(
      "Receiver is not a valid WhatsApp user",
    );
  });

  it("falls back to the generic title when there is no specific detail", () => {
    const payload = statusPayload([
      { id: "wamid.1", status: "failed", errors: [{ code: 131026, title: "Undeliverable" }] },
    ]);
    expect(parseWhatsAppDeliveryEvents(payload, NOW)[0].detail).toBe("Undeliverable");
  });

  it("falls back to now for a missing or unparseable timestamp", () => {
    const payload = statusPayload([
      { id: "wamid.1", status: "sent" },
      { id: "wamid.2", status: "sent", timestamp: "not-a-number" },
    ]);
    for (const event of parseWhatsAppDeliveryEvents(payload, NOW)) {
      expect(event.occurredAt).toEqual(NOW);
    }
  });

  it("ignores an inbound message — that is the shop's own inbox, not DiveDay's", () => {
    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "13055551234", id: "wamid.in", type: "text" }],
              },
            },
          ],
        },
      ],
    });
    expect(parseWhatsAppDeliveryEvents(payload, NOW)).toEqual([]);
  });

  it("returns nothing for malformed or unrelated payloads rather than throwing", () => {
    for (const payload of ["", "not json", "{}", '{"entry":[]}', '{"entry":"nope"}']) {
      expect(parseWhatsAppDeliveryEvents(payload, NOW)).toEqual([]);
    }
  });

  it("collects statuses across several entries in one batch", () => {
    const payload = JSON.stringify({
      entry: [
        { changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }] } }] },
        { changes: [{ value: { statuses: [{ id: "wamid.2", status: "failed" }] } }] },
      ],
    });
    expect(parseWhatsAppDeliveryEvents(payload, NOW)).toHaveLength(2);
  });
});
