import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WHATSAPP_TEMPLATE_NAME,
  META_TEMPLATE_LANGUAGES,
  metaLanguageCode,
  templateParameter,
  whatsAppProvider,
  whatsAppRecipient,
} from "./whatsapp";

const credentials = {
  phoneNumberId: "1234567890",
  accessToken: "EAAG-secret-token",
  templateName: DEFAULT_WHATSAPP_TEMPLATE_NAME,
  templateLanguage: "en_US",
};

const message = {
  to: "+13055551234",
  body: "Reef Runner departs Sat at 8:00 AM. Dock call 30 min early.",
  shopName: "Blue Horizon Divers",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function okResponse(id = "wamid.ABC123") {
  return jsonResponse(200, {
    messaging_product: "whatsapp",
    contacts: [{ input: "13055551234", wa_id: "13055551234" }],
    messages: [{ id }],
  });
}

/** No real backoff in tests; the retry *decision* is what matters, not the wait. */
const noWait = { sleep: async () => {}, random: () => 0 };

describe("whatsAppRecipient", () => {
  it("returns digits only, dropping the plus Meta does not want", () => {
    expect(whatsAppRecipient("+13055551234")).toBe("13055551234");
  });

  it("strips human separators before validating", () => {
    expect(whatsAppRecipient("+1 (305) 555-1234")).toBe("13055551234");
  });

  it("refuses a number with no unambiguous country code rather than guessing one", () => {
    for (const value of ["555-1234", "3055551234", "", null, undefined, "+0123456"]) {
      expect(whatsAppRecipient(value)).toBeNull();
    }
  });
});

describe("templateParameter", () => {
  it("collapses newlines and tabs Meta rejects in a parameter", () => {
    expect(templateParameter("Reef Runner\ndeparts\tat 8")).toBe("Reef Runner departs at 8");
  });

  it("collapses runs of more than four spaces", () => {
    expect(templateParameter("Reef      Runner")).toBe("Reef Runner");
  });

  it("caps at Meta's 1024-character parameter limit", () => {
    const result = templateParameter("a".repeat(2_000));
    expect(result).toHaveLength(1_024);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves an ordinary one-line body untouched", () => {
    expect(templateParameter(message.body)).toBe(message.body);
  });
});

describe("metaLanguageCode", () => {
  it("maps diver locales onto Meta's underscore codes", () => {
    expect(metaLanguageCode("en-US")).toBe("en_US");
    expect(metaLanguageCode("es-ES")).toBe("es_ES");
    expect(META_TEMPLATE_LANGUAGES).toEqual(["en_US", "es_ES"]);
  });
});

describe("whatsAppProvider", () => {
  it("posts a template message to the shop's own phone number id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toEqual({ status: "sent", providerMessageId: "wamid.ABC123" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer EAAG-secret-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "13055551234",
      type: "template",
      template: {
        name: "diveday_courtesy_update",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Blue Horizon Divers" },
              { type: "text", text: message.body },
            ],
          },
        ],
      },
    });
  });

  it("sends the shop's approved template name and language, not a hard-coded pair", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await whatsAppProvider(
      { ...credentials, templateName: "buceo_aviso", templateLanguage: "es_ES" },
      fetchImpl,
      noWait,
    ).send(message);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.template.name).toBe("buceo_aviso");
    expect(body.template.language.code).toBe("es_ES");
  });

  it("never sends a free-form text message — business-initiated must be a template", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.type).toBe("template");
    expect(body).not.toHaveProperty("text");
  });

  it("sanitizes a multi-line body into a parameter Meta will accept", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await whatsAppProvider(credentials, fetchImpl, noWait).send({
      ...message,
      body: "Line one\nLine two",
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.template.components[0].parameters[1].text).toBe("Line one Line two");
  });

  it("refuses a number it cannot dial, without calling Meta", async () => {
    const fetchImpl = vi.fn();
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send({
      ...message,
      to: "555-1234",
    });

    expect(delivery).toEqual({
      status: "failed",
      retryable: false,
      errorCode: "invalid_recipient",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an expired token as a non-retryable failure carrying Meta's code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { message: "Error validating access token", type: "OAuthException", code: 190 },
      }),
    );
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toEqual({
      status: "failed",
      retryable: false,
      httpStatus: 401,
      errorCode: "190",
      detail: "Error validating access token",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports an unapproved template without retrying it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: {
          message: "Template name does not exist in the translation",
          code: 132001,
          error_subcode: 2494010,
        },
      }),
    );
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toMatchObject({
      status: "failed",
      retryable: false,
      errorCode: "132001/2494010",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a diver who is not on WhatsApp as non-retryable, so the caller falls back", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: { message: "Message undeliverable", code: 131026 } }),
      );
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toMatchObject({ status: "failed", retryable: false, errorCode: "131026" });
  });

  it("retries a rate limit and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "Too many", code: 130429 } }))
      .mockResolvedValueOnce(okResponse("wamid.RETRY"));
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toEqual({ status: "sent", providerMessageId: "wamid.RETRY" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx and gives up as retryable after the attempt cap", async () => {
    // A fresh Response per call: a body can only be read once, so a shared
    // mock value would fail the retry for the wrong reason.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(503, {}));
    const delivery = await whatsAppProvider(credentials, fetchImpl, {
      ...noWait,
      maxAttempts: 3,
    }).send(message);

    expect(delivery).toMatchObject({ status: "failed", retryable: true, httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a network failure as retryable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const delivery = await whatsAppProvider(credentials, fetchImpl, {
      ...noWait,
      maxAttempts: 2,
    }).send(message);

    expect(delivery).toMatchObject({
      status: "failed",
      retryable: true,
      errorCode: "network_error",
      detail: "socket hang up",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a 200 with no message id as a retryable invalid response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messaging_product: "whatsapp" }));
    const delivery = await whatsAppProvider(credentials, fetchImpl, noWait).send(message);

    expect(delivery).toEqual({ status: "failed", retryable: true, errorCode: "invalid_response" });
  });

  it("survives a non-JSON error body rather than throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("<html>gateway</html>", { status: 502 }));
    const delivery = await whatsAppProvider(credentials, fetchImpl, {
      ...noWait,
      maxAttempts: 1,
    }).send(message);

    expect(delivery).toMatchObject({ status: "failed", retryable: true, httpStatus: 502 });
  });
});
