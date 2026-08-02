import { describe, expect, it, vi } from "vitest";
import {
  completeEmbeddedSignup,
  courtesyTemplateDefinition,
  generateRegistrationPin,
  whatsAppSignupConfigFromEnvironment,
} from "./whatsapp-signup";

const config = { appId: "app-1", appSecret: "app-secret", configId: "config-1" };

const input = {
  code: "AQD-signup-code",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  templateName: "diveday_courtesy_update",
  templateLanguage: "en_US",
  registrationPin: "123456",
  templateCopy: {
    body: "Hi! An update from {{1}}: {{2}}",
    exampleShopName: "Blue Mantis Divers",
    exampleMessage: "Reef Runner departs Saturday at 8:00 AM.",
  },
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * The happy path in order: exchange, register, subscribe, template. Each test
 * overrides only the call it cares about.
 */
function fetchSequence(overrides: Partial<Record<number, Response>> = {}) {
  const defaults = [
    json(200, { access_token: "EAAG-business-token" }),
    json(200, { success: true }),
    json(200, { success: true }),
    json(200, { id: "template-1", status: "PENDING" }),
  ];
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    const index = call++;
    return overrides[index] ?? defaults[index] ?? json(200, {});
  });
}

describe("whatsAppSignupConfigFromEnvironment", () => {
  it("reads DiveDay's own Meta app credentials", () => {
    expect(
      whatsAppSignupConfigFromEnvironment({
        META_APP_ID: "app-1",
        META_APP_SECRET: "app-secret",
        META_WHATSAPP_SIGNUP_CONFIG_ID: "config-1",
      }),
    ).toEqual(config);
  });

  it("is null until the app is configured, so the button stays unavailable", () => {
    expect(whatsAppSignupConfigFromEnvironment({})).toBeNull();
    expect(whatsAppSignupConfigFromEnvironment({ META_APP_ID: "app-1" })).toBeNull();
  });
});

describe("generateRegistrationPin", () => {
  it("is always six digits, including for a small draw", () => {
    expect(generateRegistrationPin(() => 0)).toBe("000000");
    expect(generateRegistrationPin(() => 7)).toBe("000007");
    expect(generateRegistrationPin(() => 999_999)).toBe("999999");
  });

  it("draws from the crypto RNG by default, across the whole six-digit range", () => {
    const pins = new Set(Array.from({ length: 200 }, () => generateRegistrationPin()));
    expect(pins.size).toBeGreaterThan(150);
    for (const pin of pins) expect(pin).toMatch(/^\d{6}$/);
  });
});

describe("courtesyTemplateDefinition", () => {
  it("declares two body variables with the examples Meta requires on create", () => {
    const definition = courtesyTemplateDefinition(
      "diveday_courtesy_update",
      "en_US",
      input.templateCopy,
    );
    expect(definition.category).toBe("UTILITY");
    expect(definition.components[0].text).toContain("{{1}}");
    expect(definition.components[0].text).toContain("{{2}}");
    expect(definition.components[0].example.body_text[0]).toHaveLength(2);
  });
});

describe("completeEmbeddedSignup", () => {
  it("exchanges, registers, subscribes, and provisions the template in order", async () => {
    const fetchImpl = fetchSequence();
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toEqual({
      status: "completed",
      accessToken: "EAAG-business-token",
      templateAlreadyExisted: false,
    });
    const urls = fetchImpl.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls[0]).toContain("/oauth/access_token");
    expect(urls[1]).toContain("/phone-1/register");
    expect(urls[2]).toContain("/waba-1/subscribed_apps");
    expect(urls[3]).toContain("/waba-1/message_templates");
  });

  it("signs the exchange with the app secret, and never sends it again after", async () => {
    const fetchImpl = fetchSequence();
    await completeEmbeddedSignup(input, config, fetchImpl);

    const [exchangeUrl] = fetchImpl.mock.calls[0];
    expect(exchangeUrl).toContain("client_id=app-1");
    expect(exchangeUrl).toContain("client_secret=app-secret");
    expect(exchangeUrl).toContain("code=AQD-signup-code");
    for (const [url, init] of fetchImpl.mock.calls.slice(1)) {
      expect(url).not.toContain("app-secret");
      expect(init.headers.Authorization).toBe("Bearer EAAG-business-token");
    }
  });

  it("registers the number with the generated PIN", async () => {
    const fetchImpl = fetchSequence();
    await completeEmbeddedSignup(input, config, fetchImpl);

    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      messaging_product: "whatsapp",
      pin: "123456",
    });
  });

  it("subscribes DiveDay's app to the shop's WABA — what makes webhooks arrive", async () => {
    const fetchImpl = fetchSequence();
    await completeEmbeddedSignup(input, config, fetchImpl);

    expect(fetchImpl.mock.calls[2][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[2][0]).toContain("/waba-1/subscribed_apps");
  });

  it("reports which step failed when the code is already spent", async () => {
    const fetchImpl = fetchSequence({
      0: json(400, { error: { message: "This authorization code has been used", code: 100 } }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({
      status: "failed",
      step: "exchange",
      httpStatus: 400,
      errorCode: "100",
    });
    // Nothing further is attempted with a token we never got.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops before subscribing when the number cannot be registered", async () => {
    const fetchImpl = fetchSequence({
      1: json(400, { error: { message: "Bad PIN", code: 131000 } }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({ status: "failed", step: "register" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails on a PIN mismatch instead of swallowing it — 133005 is not a reconnect", async () => {
    // 133005 means the number is bound to a *different* PIN, which is exactly
    // what staff need told about. Swallowing it also used to overwrite the
    // stored PIN with one Meta had never accepted.
    const fetchImpl = fetchSequence({
      1: json(400, { error: { message: "PIN mismatch", code: 133005 } }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({ status: "failed", step: "register", errorCode: "133005" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips registration entirely on a reconnect, never re-sending a PIN", async () => {
    // Meta binds a number to the PIN it was first registered with, so a second
    // register with a fresh PIN cannot succeed — and each attempt counts toward
    // a guess lockout. A null pin means "already registered, leave it alone".
    const fetchImpl = fetchSequence({
      // Only three calls now, so the template response moves up one slot.
      2: json(200, { id: "template-1", status: "PENDING" }),
    });
    const result = await completeEmbeddedSignup(
      { ...input, registrationPin: null },
      config,
      fetchImpl,
    );

    expect(result.status).toBe("completed");
    const urls = fetchImpl.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls.some((url) => url.includes("/register"))).toBe(false);
    expect(urls[1]).toContain("/subscribed_apps");
  });

  it("does not treat a code merely containing 2388023 as an existing template", async () => {
    // `includes("2388023")` also matched 12388023; this decides whether a
    // failure is swallowed, so it compares the subcode as a number.
    const fetchImpl = fetchSequence({
      3: json(400, { error: { message: "nope", code: 100, error_subcode: 12_388_023 } }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({ status: "failed", step: "template" });
  });

  it("treats an existing template as a reconnect, not a failure", async () => {
    const fetchImpl = fetchSequence({
      3: json(400, {
        error: { message: "template exists", code: 100, error_subcode: 2388023 },
      }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({ status: "completed", templateAlreadyExisted: true });
  });

  it("fails on a genuine template rejection", async () => {
    const fetchImpl = fetchSequence({
      3: json(400, { error: { message: "Invalid parameter", code: 100 } }),
    });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({ status: "failed", step: "template" });
  });

  it("reports a subscribe that answers success:false", async () => {
    const fetchImpl = fetchSequence({ 2: json(200, { success: false }) });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({
      status: "failed",
      step: "subscribe",
      errorCode: "not_subscribed",
    });
  });

  it("survives a network failure without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({
      status: "failed",
      step: "exchange",
      errorCode: "network_error",
    });
  });

  it("reports an exchange that returns no token", async () => {
    const fetchImpl = fetchSequence({ 0: json(200, { token_type: "bearer" }) });
    const result = await completeEmbeddedSignup(input, config, fetchImpl);

    expect(result).toMatchObject({
      status: "failed",
      step: "exchange",
      errorCode: "invalid_response",
    });
  });
});
