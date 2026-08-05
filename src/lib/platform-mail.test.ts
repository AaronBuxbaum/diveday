import { describe, expect, it } from "vitest";
import { ALERT_EMAIL, alertRecipient } from "./platform-mail";

/**
 * `alertRecipient` is the one place both operational alerts — a trial start and
 * a demo try (docs ADR 20260805-demo-try-alerts) — resolve their destination.
 * The failure it exists to prevent is a fork or a staging deploy quietly
 * mailing DiveDay's own founder about signups that aren't ours.
 */
describe("alertRecipient", () => {
  it("falls back to the shipped mailbox when nothing is configured", () => {
    expect(alertRecipient({})).toBe(ALERT_EMAIL);
  });

  it("uses OPS_ALERT_EMAIL when a deployment sets one", () => {
    expect(alertRecipient({ OPS_ALERT_EMAIL: "ops@example.org" })).toBe("ops@example.org");
  });

  it("treats an empty or whitespace-only override as unset", () => {
    // A blanked env var is how the e2e fleet and Vercel both express "no
    // value"; taking it literally would address every alert to "" and fail
    // validation at the notification boundary instead of falling back.
    expect(alertRecipient({ OPS_ALERT_EMAIL: "" })).toBe(ALERT_EMAIL);
    expect(alertRecipient({ OPS_ALERT_EMAIL: "   " })).toBe(ALERT_EMAIL);
  });

  it("trims a value that arrived with stray whitespace", () => {
    expect(alertRecipient({ OPS_ALERT_EMAIL: "  ops@example.org  " })).toBe("ops@example.org");
  });
});
