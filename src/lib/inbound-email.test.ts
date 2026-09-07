import { describe, expect, it } from "vitest";
import {
  decodeEncodedWords,
  htmlToText,
  parseInboundEmail,
  stripQuotedReply,
} from "./inbound-email";

const CRLF = "\r\n";

function message(headers: string[], body: string): string {
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}`;
}

describe("parseInboundEmail", () => {
  it("reads a plain text reply with its headers", () => {
    const raw = message(
      [
        "From: Priya Sharma <priya@example.com>",
        "To: reply+3f2504e0-4f89-41d3-9a0c-0305e82c3301@inbound.ses.dive.day",
        "Subject: Re: Your Saturday departure",
        "Message-ID: <abc@mail.example.com>",
        "In-Reply-To: <0100019abc-1234@email.amazonses.com>",
        "Content-Type: text/plain; charset=utf-8",
      ],
      "Can I switch to the afternoon boat?\r\n\r\nPriya",
    );
    expect(parseInboundEmail(raw)).toEqual({
      from: "Priya Sharma <priya@example.com>",
      to: ["reply+3f2504e0-4f89-41d3-9a0c-0305e82c3301@inbound.ses.dive.day"],
      subject: "Re: Your Saturday departure",
      messageId: "<abc@mail.example.com>",
      inReplyTo: "<0100019abc-1234@email.amazonses.com>",
      text: "Can I switch to the afternoon boat?\n\nPriya",
      attachmentCount: 0,
    });
  });

  it("takes the text/plain half of a multipart/alternative and decodes quoted-printable", () => {
    const raw = message(
      [
        "From: lena@example.com",
        "To: reply+x@inbound.ses.dive.day",
        "Subject: =?UTF-8?B?UmU6IEVzdMOhcyByZXNlcnZhZGE=?=",
        'Content-Type: multipart/alternative; boundary="b1"',
      ],
      [
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "=C2=BFTienen trajes de 5mm? Gracias =E2=80=94 Lena",
        "--b1",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>&iquest;Tienen trajes de 5mm?</p>",
        "--b1--",
        "",
      ].join(CRLF),
    );
    const parsed = parseInboundEmail(raw);
    expect(parsed.subject).toBe("Re: Estás reservada");
    expect(parsed.text).toBe("¿Tienen trajes de 5mm? Gracias — Lena");
    expect(parsed.attachmentCount).toBe(0);
  });

  it("decodes a base64 body in a nested multipart/mixed and counts the attachment", () => {
    const text = Buffer.from("Here is my card.\n", "utf8").toString("base64");
    const raw = message(
      [
        "From: tom@example.com",
        "To: reply+x@inbound.ses.dive.day",
        "Subject: card",
        'Content-Type: multipart/mixed; boundary="outer"',
      ],
      [
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        text,
        "--inner",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<div>Here is my card.</div>",
        "--inner--",
        "--outer",
        "Content-Type: image/jpeg; name=card.jpg",
        'Content-Disposition: attachment; filename="card.jpg"',
        "Content-Transfer-Encoding: base64",
        "",
        "/9j/4AAQSkZJRg==",
        "--outer--",
      ].join(CRLF),
    );
    const parsed = parseInboundEmail(raw);
    expect(parsed.text).toBe("Here is my card.");
    expect(parsed.attachmentCount).toBe(1);
  });

  it("falls back to the HTML part reduced to text when there is no text/plain", () => {
    const raw = message(
      [
        "From: a@example.com",
        "To: b@inbound.ses.dive.day",
        "Content-Type: text/html; charset=utf-8",
      ],
      "<html><body><p>Hi&nbsp;there,</p><p>Two of us &amp; a friend.<br>Thanks</p><style>p{}</style></body></html>",
    );
    expect(parseInboundEmail(raw).text).toBe("Hi there,\nTwo of us & a friend.\nThanks");
  });

  it("unfolds a header that wraps across lines and splits several To addresses", () => {
    const raw = message(
      [
        "From: a@example.com",
        "To: reply+one@inbound.ses.dive.day,",
        "  Someone Else <two@example.com>",
        "Subject: hello",
      ],
      "hi",
    );
    const parsed = parseInboundEmail(raw);
    expect(parsed.to).toEqual(["reply+one@inbound.ses.dive.day", "Someone Else <two@example.com>"]);
    expect(parsed.subject).toBe("hello");
  });

  it("never throws on garbage, and yields empty text rather than the raw bytes of an unknown part", () => {
    expect(parseInboundEmail("")).toMatchObject({ from: null, to: [], text: "" });
    expect(parseInboundEmail("no headers at all")).toMatchObject({ text: "" });
    const raw = message(
      ["From: a@example.com", 'Content-Type: multipart/mixed; boundary="x"'],
      "--x\r\nContent-Type: application/pdf\r\n\r\nJVBERi0=\r\n--x--",
    );
    expect(parseInboundEmail(raw)).toMatchObject({ text: "", attachmentCount: 1 });
  });
});

describe("stripQuotedReply", () => {
  it("cuts at the attribution line and the quoted block, in English and Spanish", () => {
    expect(
      stripQuotedReply(
        "Yes please.\n\nOn Sat, 18 Jul 2026 at 09:12, Blue Mantis <reply+x@inbound.ses.dive.day> wrote:\n> Your seat is confirmed.\n",
      ),
    ).toBe("Yes please.");
    expect(
      stripQuotedReply("Sí, gracias.\n\nEl sáb, 18 jul 2026, Blue Mantis escribió:\n> Hola"),
    ).toBe("Sí, gracias.");
    expect(stripQuotedReply("Ok\n> quoted\n> more")).toBe("Ok");
  });

  it("cuts an Outlook divider and a pasted header block", () => {
    expect(stripQuotedReply("Fine by me\n\n-----Original Message-----\nFrom: x\nSent: y")).toBe(
      "Fine by me",
    );
    expect(stripQuotedReply("Fine by me\n\nFrom: Blue Mantis\nSent: Saturday\nTo: me")).toBe(
      "Fine by me",
    );
  });

  it("keeps a reply that is only quoted text rather than filing it empty", () => {
    expect(stripQuotedReply("> is this still on?")).toBe("> is this still on?");
  });

  it("handles a wrapped attribution whose 'wrote:' fell to the next line", () => {
    expect(
      stripQuotedReply("Sure\n\nOn Sat, Jul 18, 2026 at 9:12 AM Blue Mantis\n<x@y> wrote:\n> hi"),
    ).toBe("Sure");
  });
});

describe("decodeEncodedWords and htmlToText", () => {
  it("decodes B and Q encoded words, joining adjacent ones", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?Re=3A_Est=C3=A1s?= =?UTF-8?Q?_reservada?=")).toBe(
      "Re: Estás reservada",
    );
    expect(decodeEncodedWords("plain subject")).toBe("plain subject");
  });

  it("keeps block breaks and drops scripts", () => {
    expect(htmlToText("<p>a</p><script>x()</script><ul><li>b</li><li>c</li></ul>")).toBe("a\nb\nc");
  });

  /**
   * **An unclosed `<script>` is dropped, not scanned for.**
   *
   * The obvious pattern for this — a lazy `[\s\S]*?` between the opening and
   * closing tags — is quadratic on exactly this input: every unmatched
   * `<script` re-scans to the end. Measured at 24.5 seconds for 1 MB, on a
   * path any diver holding the shop's reply address can post to, whose bytes
   * are capped at 2 MB rather than at anything small. This asserts the
   * behaviour; the size is what makes a regression time the test out rather
   * than pass slowly.
   */
  it("drops an unterminated raw-text element instead of scanning for its close", () => {
    expect(htmlToText("<p>hello</p><script>x()")).toBe("hello");
    expect(htmlToText(`<p>hi</p>${"<script>".repeat(120_000)}`)).toBe("hi");
  });

  /**
   * **Nothing that opened a tag survives as text.** `.replace(/<[^>]+>/g, "")`
   * leaves a trailing `<img src=x onerror=…` — a `<` with no `>` after it —
   * standing in the output, which is a live element the moment anything reads
   * the string as markup. A browser treats an unterminated tag as running to
   * the end of the document; so does this.
   */
  it("takes an unterminated tag with it rather than leaving a live one behind", () => {
    expect(htmlToText("<p>hi</p><img src=x onerror=alert(1)")).toBe("hi");
    expect(htmlToText("<p>hi</p><scr<b>ipt>")).toBe("hi\nipt>");
  });

  /**
   * **Entities are decoded once, not six times over each other.** A sender who
   * wrote a literal `&lt;` sends `&amp;lt;`; unescaping `&amp;` and then `&lt;`
   * in separate passes turns that into `<` and puts a character in their
   * message they never typed.
   */
  it("decodes an entity once, so an escaped entity stays escaped", () => {
    expect(htmlToText("<p>&amp;lt; is how you write &lt;</p>")).toBe("&lt; is how you write <");
    expect(htmlToText("<p>Tom &amp; Jerry &nbsp;&quot;hi&quot; &#39;yes&#39; &gt;</p>")).toBe(
      "Tom & Jerry  \"hi\" 'yes' >",
    );
  });
});
