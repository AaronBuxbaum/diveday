import { describe, expect, it } from "vitest";
import {
  DEFAULT_INBOUND_EMAIL_DOMAIN,
  inboundEmailDomain,
  shopInboundReplyAddress,
} from "./inbound-address";

const TOKEN = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";

describe("the inbound domain (ADR 20260907-two-way-inbox)", () => {
  it("is the compiled default under the sending identity unless overridden", () => {
    expect(DEFAULT_INBOUND_EMAIL_DOMAIN).toBe("inbound.ses.dive.day");
    expect(inboundEmailDomain({})).toBe("inbound.ses.dive.day");
    expect(inboundEmailDomain({ EMAIL_INBOUND_DOMAIN: "Replies.Example.Test" })).toBe(
      "replies.example.test",
    );
  });

  it("is switched off by an explicit empty override, and the address with it", () => {
    expect(inboundEmailDomain({ EMAIL_INBOUND_DOMAIN: "" })).toBeUndefined();
    expect(shopInboundReplyAddress(TOKEN, { EMAIL_INBOUND_DOMAIN: " " })).toBeUndefined();
  });

  it("builds the shop's reply address, lowercased", () => {
    expect(shopInboundReplyAddress(TOKEN, {})).toBe(
      `reply+${TOKEN.toLowerCase()}@inbound.ses.dive.day`,
    );
  });
});
