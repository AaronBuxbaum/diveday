import { describe, expect, it } from "vitest";
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
});
