import { describe, expect, it } from "vitest";
import { decode } from "../../e2e/crew-pdf-pixels";

describe("crew PDF XML text decoding", () => {
  it("decodes the five XML entities", () => {
    expect(decode("A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;")).toBe("A&B <C> \"D\" 'E'");
  });

  it("preserves entity text escaped inside XML", () => {
    expect(decode("&amp;lt; &amp;gt; &amp;quot; &amp;apos; &amp;amp;")).toBe(
      "&lt; &gt; &quot; &apos; &amp;",
    );
  });

  it("leaves unknown entities and plain text unchanged", () => {
    expect(decode("MON crew &#65; &unknown; & incomplete")).toBe(
      "MON crew &#65; &unknown; & incomplete",
    );
  });
});
