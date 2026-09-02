import { describe, expect, it } from "vitest";

import { maskEmailAddresses, redactCapabilityUrls } from "./ses";

/**
 * What a provider's own error string is allowed to keep (security review on
 * issue #1297).
 *
 * `detail` is AWS's prose, and it is **persisted** in three columns —
 * `notification_send_queue.last_error`, `notification_deliveries.send_error`,
 * `waiver_records.delivery_error` — not merely logged. So the boundary that
 * builds it is where a credential has to be removed, rather than at whichever
 * consumer remembered.
 *
 * The line drawn here is between a **credential** and an **identifier**. A
 * capability link goes, because it is a working bearer token and #1297 sealed
 * that same token out of the column next door. A refused address stays,
 * because it is the whole diagnosis on an operator-facing failure row — a
 * decision this repository already made and pins in `index.test.ts` ("keeps
 * the refused identity in the failure detail but out of the log line").
 * AGENTS.md's rule governs what a *log line* may carry, and
 * `maskEmailAddresses` still applies there.
 */
describe("redactCapabilityUrls", () => {
  it("redacts a capability link AWS quoted back at us", () => {
    // The shape of an AWS validation exception: it echoes the offending value,
    // and for half the notification kinds that value is a link carrying a raw
    // bearer token — the same token this row's payload was sealed to hide.
    expect(
      redactCapabilityUrls(
        "Value 'https://diveday.test/waivers/9f3a-secret-token' at 'content' failed to satisfy constraint",
      ),
    ).toBe("Value '/waivers/[token]' at 'content' failed to satisfy constraint");
  });

  it("redacts every capability prefix, not only the first it learned about", () => {
    for (const prefix of ["verify", "reset-password", "invite", "confirm-contact", "claim"]) {
      expect(redactCapabilityUrls(`rejected https://diveday.test/${prefix}/raw-token-value`)).toBe(
        `rejected /${prefix}/[token]`,
      );
    }
  });

  it("redacts more than one link in the same message", () => {
    expect(
      redactCapabilityUrls(
        "https://diveday.test/ready/tok-a then https://diveday.test/recap/tok-b",
      ),
    ).toBe("/ready/[token] then /recap/[token]");
  });

  it("leaves an ordinary URL and ordinary prose alone", () => {
    // Redaction must not make an operator's error unreadable: what is not a
    // credential stays, or the column stops being worth reading.
    expect(
      redactCapabilityUrls(
        "Throttling: Maximum sending rate exceeded, see https://aws.amazon.com/ses",
      ),
    ).toBe("Throttling: Maximum sending rate exceeded, see https://aws.amazon.com/ses");
  });

  it("leaves a refused address in place — it is the diagnosis, not a credential", () => {
    expect(redactCapabilityUrls("Email address is not verified: nora@example.com")).toBe(
      "Email address is not verified: nora@example.com",
    );
  });
});

describe("maskEmailAddresses", () => {
  it("keeps the domain, which is what names the unverified identity", () => {
    expect(maskEmailAddresses("desk@bluemantis.dive is not verified")).toBe(
      "<redacted>@bluemantis.dive is not verified",
    );
  });

  it("masks every address in the string", () => {
    expect(maskEmailAddresses("from a@one.test to b@two.test")).toBe(
      "from <redacted>@one.test to <redacted>@two.test",
    );
  });
});
