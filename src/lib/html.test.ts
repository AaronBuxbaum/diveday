import { describe, expect, it } from "vitest";
import { arrivalCardDocument, escapeHtml as arrivalCardEscapeHtml } from "./arrival-card-document";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quote'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Bob's Dive Shop")).toBe("Bob&#39;s Dive Shop");
  });

  it("neutralizes an attribute-breakout attempt", () => {
    const malicious = `" onmouseover="alert(1)`;
    expect(escapeHtml(malicious)).not.toContain('"');
  });

  it("shares the HTML escaper with saved arrival-card documents", () => {
    const malicious = `<img src=x onerror="alert('x')"> &`;

    expect(arrivalCardEscapeHtml).toBe(escapeHtml);
    const document = arrivalCardDocument({
      locale: `en" onload="alert(1)`,
      title: malicious,
      shopName: "Shop",
      tripTitle: "Trip",
      when: "Tomorrow",
      dockCallLine: null,
      notices: [malicious],
      fields: [{ label: malicious, value: malicious }],
      footerHtml: `<p>${arrivalCardEscapeHtml(malicious)}</p>`,
    });

    expect(document).toContain('lang="en&quot; onload=&quot;alert(1)"');
    expect(document).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;");
    expect(document).not.toContain(malicious);
  });
});
