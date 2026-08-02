import { describe, expect, it, vi } from "vitest";
import {
  type SmsMessage,
  smsProviderFromEnvironment,
  smsRecipient,
  twilioSmsProvider,
} from "./sms";

describe("smsRecipient", () => {
  it("accepts and cleans an E.164 number", () => {
    expect(smsRecipient("+1 (305) 555-1234")).toBe("+13055551234");
    expect(smsRecipient("+13055551234")).toBe("+13055551234");
  });

  it("rejects anything without an unambiguous country code", () => {
    expect(smsRecipient("305-555-1234")).toBeNull();
    expect(smsRecipient("555-1234")).toBeNull();
    expect(smsRecipient("")).toBeNull();
    expect(smsRecipient(null)).toBeNull();
    expect(smsRecipient(undefined)).toBeNull();
  });
});

/** A fetch stub that records its calls and returns a Twilio-shaped 200. */
function okFetch(sid = "SM123") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ sid }), { status: 200 });
  }) as typeof fetch;
  return Object.assign(fetchImpl, { calls });
}

const config = {
  accountSid: "AC_test",
  authToken: "secret",
  smsFrom: "+15005550006",
  whatsappFrom: "+15005550007",
};

const message: SmsMessage = { channel: "sms", to: "+13055551234", body: "See you Saturday" };

describe("twilioSmsProvider", () => {
  it("posts an SMS to the account's Messages endpoint with basic auth", async () => {
    const fetchImpl = okFetch("SM_sent");
    const result = await twilioSmsProvider(config, fetchImpl).send(message);
    expect(result).toEqual({ status: "sent", providerMessageId: "SM_sent" });

    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC_test:secret").toString("base64")}`,
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get("To")).toBe("+13055551234");
    expect(form.get("From")).toBe("+15005550006");
    expect(form.get("Body")).toBe("See you Saturday");
  });

  it("prefixes both numbers with whatsapp: on the WhatsApp channel", async () => {
    const fetchImpl = okFetch();
    await twilioSmsProvider(config, fetchImpl).send({ ...message, channel: "whatsapp" });
    const form = new URLSearchParams(fetchImpl.calls[0].init.body as string);
    expect(form.get("To")).toBe("whatsapp:+13055551234");
    expect(form.get("From")).toBe("whatsapp:+15005550007");
  });

  it("is not_configured when the requested channel has no sender", async () => {
    const fetchImpl = okFetch();
    const provider = twilioSmsProvider({ ...config, whatsappFrom: undefined }, fetchImpl);
    expect(await provider.send({ ...message, channel: "whatsapp" })).toEqual({
      status: "not_configured",
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("fails on a non-2xx response or an unparseable body", async () => {
    const rejecting = vi.fn(async () => new Response(null, { status: 400 }));
    expect(await twilioSmsProvider(config, rejecting).send(message)).toEqual({ status: "failed" });

    const garbage = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await twilioSmsProvider(config, garbage).send(message)).toEqual({ status: "failed" });
  });

  it("fails closed when the network throws", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await twilioSmsProvider(config, throwing).send(message)).toEqual({ status: "failed" });
  });
});

describe("smsProviderFromEnvironment", () => {
  it("disables (not_configured) when credentials are absent", async () => {
    const provider = smsProviderFromEnvironment({}, okFetch());
    expect(await provider.send(message)).toEqual({ status: "not_configured" });
  });

  it("builds a live Twilio provider when credentials are present", async () => {
    const fetchImpl = okFetch("SM_env");
    const provider = smsProviderFromEnvironment(
      {
        TWILIO_ACCOUNT_SID: "AC_env",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_SMS_FROM: "+15005550006",
      },
      fetchImpl,
    );
    expect(await provider.send(message)).toEqual({ status: "sent", providerMessageId: "SM_env" });
  });
});
