import { describe, expect, it } from "vitest";
import { previewActiveAlertEmail } from "./email";

describe("previewActiveAlertEmail (ADR 20261116-demo-previews)", () => {
  it("names the prospect and the shop, with the two counts beside the news", () => {
    const email = previewActiveAlertEmail({
      prospectName: "Reef Line Divers",
      shopSlug: "rolling-basin-dive-co",
      fetchCount: 12,
      openCount: 1,
    });
    expect(email.subject).toBe("Preview in use: Reef Line Divers");
    expect(email.text).toContain("/shop/rolling-basin-dive-co");
    expect(email.text).toContain("Link requested 12 time(s), opened in a browser 1 time(s).");
  });

  it("escapes a name the founder typed", () => {
    const email = previewActiveAlertEmail({
      prospectName: "<b>Reef</b> & Co",
      shopSlug: "x",
      fetchCount: 0,
      openCount: 0,
    });
    expect(email.html).toContain("&lt;b&gt;Reef&lt;/b&gt; &amp; Co");
    expect(email.html).not.toContain("<b>Reef</b>");
  });
});
