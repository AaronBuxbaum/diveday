import { describe, expect, it, vi } from "vitest";
import {
  isAllowedPushEndpoint,
  sendWebPush,
  WEB_PUSH_TTL_SECONDS,
  webPushConfig,
} from "./web-push";

const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@dive.day" };
const target = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "p", auth: "a" };

describe("webPushConfig", () => {
  it("returns null when unconfigured rather than throwing", () => {
    // Push being off must degrade to "no push", never take down every route
    // that transitively imports this module.
    expect(webPushConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns null when only some of the three are set", () => {
    expect(
      webPushConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("returns the config when all three are set", () => {
    expect(
      webPushConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:ops@dive.day",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual(config);
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://par02p.notify.windows.com/w/?token=abc",
  ])("accepts the real push service %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it("rejects a private address, which a protocol check alone would pass", () => {
    // The whole point of the allowlist: this server POSTs to the endpoint, so
    // an unvalidated value is a server-side request forgery primitive.
    expect(isAllowedPushEndpoint("https://10.0.0.1/push")).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost/push")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects a lookalike host that merely contains an allowed one", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.attacker.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilnotify.windows.com/x")).toBe(false);
  });

  it("accepts a regional subdomain of an allowed host", () => {
    expect(isAllowedPushEndpoint("https://sin.notify.windows.com/w/?token=abc")).toBe(true);
  });

  it("rejects non-https and unparseable values", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint("")).toBe(false);
  });

  it("rejects an over-long endpoint before parsing it", () => {
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(4000)}`)).toBe(false);
  });
});

describe("sendWebPush", () => {
  it("sends the payload as JSON with VAPID details and a short TTL", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendWebPush(target, { kind: "manifest-changed" }, config, send);

    expect(result).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify({ kind: "manifest-changed" }),
      expect.objectContaining({
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: WEB_PUSH_TTL_SECONDS,
      }),
    );
  });

  it.each([404, 410])("reports %i as gone, so the caller deletes the row", async (statusCode) => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode }));
    expect(await sendWebPush(target, {}, config, send)).toEqual({ status: "gone" });
  });

  it("reports a transient 500 as failed, so a live subscription is not deleted", async () => {
    // The distinction that matters: a push service having a bad minute must not
    // silently unsubscribe a captain's phone.
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    expect(await sendWebPush(target, {}, config, send)).toEqual({ status: "failed" });
  });

  it("never throws, even on an error carrying no status at all", async () => {
    // This runs off the back of a roll-call write; throwing here would fail the
    // write a captain is standing on the dock waiting for.
    const send = vi.fn().mockRejectedValue("not even an error");
    expect(await sendWebPush(target, {}, config, send)).toEqual({ status: "failed" });
  });
});
