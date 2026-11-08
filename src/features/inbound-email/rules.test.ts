import { describe, expect, it, vi } from "vitest";
import {
  htmlToText,
  MAX_INBOUND_MESSAGE_BYTES,
  parseInboundEmail,
  stripQuotedReply,
} from "./rules";

// The real parser, with `addressParser` spied so a case can make it throw.
vi.mock("postal-mime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("postal-mime")>();
  return { ...actual, addressParser: vi.fn(actual.addressParser) };
});
const { addressParser } = await import("postal-mime");

const CRLF = "\r\n";

function message(headers: string[], body: string): string {
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}`;
}

describe("parseInboundEmail", () => {
  it("reads a plain text reply with its headers", async () => {
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
    expect(await parseInboundEmail(raw)).toEqual({
      from: "priya@example.com",
      subject: "Re: Your Saturday departure",
      messageId: "<abc@mail.example.com>",
      inReplyTo: "<0100019abc-1234@email.amazonses.com>",
      text: "Can I switch to the afternoon boat?\n\nPriya",
      attachmentCount: 0,
    });
  });

  it("takes the text/plain half of a multipart/alternative and decodes quoted-printable", async () => {
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
    const parsed = await parseInboundEmail(raw);
    expect(parsed.subject).toBe("Re: Estás reservada");
    expect(parsed.text).toBe("¿Tienen trajes de 5mm? Gracias — Lena");
    expect(parsed.attachmentCount).toBe(0);
  });

  it("decodes a base64 body in a nested multipart/mixed and counts the attachment", async () => {
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
    const parsed = await parseInboundEmail(raw);
    expect(parsed.text).toBe("Here is my card.");
    expect(parsed.attachmentCount).toBe(1);
  });

  it("falls back to the HTML part reduced to text when there is no text/plain", async () => {
    const raw = message(
      [
        "From: a@example.com",
        "To: b@inbound.ses.dive.day",
        "Content-Type: text/html; charset=utf-8",
      ],
      "<html><body><p>Hi&nbsp;there,</p><p>Two of us &amp; a friend.<br>Thanks</p><style>p{}</style></body></html>",
    );
    expect((await parseInboundEmail(raw)).text).toBe("Hi there,\nTwo of us & a friend.\nThanks");
  });

  it("unfolds a header that wraps across lines and joins adjacent encoded words", async () => {
    const raw = message(
      ["From: a@example.com", "Subject: =?UTF-8?Q?Re=3A_Est=C3=A1s?=", "  =?UTF-8?Q?_reservada?="],
      "hi",
    );
    expect((await parseInboundEmail(raw)).subject).toBe("Re: Estás reservada");
  });

  it("never throws on garbage, and yields empty text rather than the raw bytes of an unknown part", async () => {
    await expect(parseInboundEmail("")).resolves.toMatchObject({ from: null, text: "" });
    const raw = message(
      ["From: a@example.com", 'Content-Type: multipart/mixed; boundary="x"'],
      "--x\r\nContent-Type: application/pdf\r\n\r\nJVBERi0=\r\n--x--",
    );
    await expect(parseInboundEmail(raw)).resolves.toMatchObject({ text: "", attachmentCount: 1 });
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

describe("htmlToText", () => {
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

/**
 * **What the library is not trusted with.** PostalMime reads the MIME; these
 * pin the app's own policies on top of it (ADR 20261102-postal-mime-inbound-reader),
 * each on input a stranger holding a shop's reply address can send.
 */
describe("parseInboundEmail against hostile input", () => {
  it("reads no sender from two From headers, two mailboxes in one, or a group", async () => {
    const twice = message(["From: priya@example.com", "From: mallory@spoofer.example"], "hi");
    expect((await parseInboundEmail(twice)).from).toBeNull();
    const two = message(["From: Priya <priya@example.com>, Mal <mallory@spoofer.example>"], "hi");
    expect((await parseInboundEmail(two)).from).toBeNull();
    const group = message(["From: Divers: priya@example.com, mallory@spoofer.example;"], "hi");
    expect((await parseInboundEmail(group)).from).toBeNull();
    // The words are still read; only the attribution is withheld.
    expect((await parseInboundEmail(twice)).text).toBe("hi");
  });

  it("reads no sender from a From the parser would have to guess at", async () => {
    for (const from of [
      "From: <victim@diver.com attacker@evil.com>",
      "From: <@evil.com:victim@diver.com>",
      "From: victim@diver.com (note) attacker@evil.com",
    ]) {
      expect((await parseInboundEmail(message([from], "hi"))).from).toBeNull();
    }
    const spaced = message(["From: victim@diver.com", "From : attacker@evil.com"], "hi");
    expect((await parseInboundEmail(spaced)).from).toBeNull();
  });

  it("reads the address of an encoded display name and never the name", async () => {
    const raw = message(["From: =?UTF-8?B?UHJpeWEgPGV2aWxAeC5jb20+?= <priya@example.com>"], "hi");
    expect((await parseInboundEmail(raw)).from).toBe("priya@example.com");
  });

  /**
   * `Message-ID` goes back out as a staff reply's `In-Reply-To`. An RFC 2047
   * word decodes to whatever bytes its author chose, CRLF included, so these
   * two are read raw — never decoded — and refused if a control character is
   * in them; a subject has them flattened to spaces.
   */
  it("keeps CR, LF and other control characters out of every header it returns", async () => {
    const crlf = Buffer.from("<a@x>\r\nBcc: victim@example.com", "utf8").toString("base64");
    const raw = message(
      [
        "From: a@example.com",
        `Message-ID: =?UTF-8?B?${crlf}?=`,
        "In-Reply-To: <id@example.com>\u0000",
        `Subject: =?UTF-8?B?${Buffer.from("Hi\r\nBcc: victim@example.com").toString("base64")}?=`,
      ],
      "hi",
    );
    const parsed = await parseInboundEmail(raw);
    expect(parsed.messageId).toBe(`=?UTF-8?B?${crlf}?=`);
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.subject).toBe("Hi Bcc: victim@example.com");
    // A bare CR inside a raw header never survives as one.
    const bare = await parseInboundEmail(
      message(["From: a@example.com", "Subject: a\rBcc: b"], "hi"),
    );
    expect(bare.subject).not.toMatch(/[\r\n]/);
  });

  it("returns the empty record when a helper after the parse throws", async () => {
    vi.mocked(addressParser).mockImplementationOnce(() => {
      throw new RangeError("boom");
    });
    await expect(parseInboundEmail(message(["From: priya@example.com"], "hi"))).resolves.toEqual({
      from: null,
      subject: null,
      messageId: null,
      inReplyTo: null,
      text: "",
      attachmentCount: 0,
    });
  });

  it("refuses a message past the byte cap before parsing it, without throwing", async () => {
    const raw = message(["From: priya@example.com"], "x".repeat(MAX_INBOUND_MESSAGE_BYTES));
    await expect(parseInboundEmail(raw)).resolves.toEqual({
      from: null,
      subject: null,
      messageId: null,
      inReplyTo: null,
      text: "",
      attachmentCount: 0,
    });
  });

  it("refuses a tree nested past sixteen levels, and reads one nested to twelve", async () => {
    const nest = (depth: number): string =>
      depth === 0
        ? `Content-Type: text/plain${CRLF}${CRLF}deep`
        : `Content-Type: multipart/mixed; boundary=b${depth}${CRLF}${CRLF}--b${depth}${CRLF}${nest(depth - 1)}${CRLF}--b${depth}--`;
    const deep = await parseInboundEmail(`From: priya@example.com${CRLF}${nest(40)}`);
    expect(deep).toMatchObject({ from: null, text: "", attachmentCount: 0 });
    const ordinary = await parseInboundEmail(`From: priya@example.com${CRLF}${nest(12)}`);
    expect(ordinary).toMatchObject({ from: "priya@example.com", text: "deep" });
  });

  it("refuses ten thousand empty parts rather than building a tree of them", async () => {
    const raw = message(
      ["From: priya@example.com", "Content-Type: multipart/mixed; boundary=b"],
      `${`--b${CRLF}${CRLF}`.repeat(10_000)}--b--`,
    );
    await expect(parseInboundEmail(raw)).resolves.toMatchObject({ from: null, text: "" });
  });

  it("refuses a header block past its own cap", async () => {
    const padding = Array.from({ length: 400 }, () => `X-Pad: ${"a".repeat(900)}`);
    const raw = message(["From: priya@example.com", ...padding], "hi");
    await expect(parseInboundEmail(raw)).resolves.toMatchObject({ from: null, text: "" });
  });

  it("counts a forwarded message as one file and never reads its words as the reply", async () => {
    const raw = message(
      ["From: priya@example.com", "Content-Type: multipart/mixed; boundary=x"],
      [
        "--x",
        "Content-Type: text/plain",
        "",
        "See below.",
        "--x",
        "Content-Type: message/rfc822",
        "",
        "From: mallory@spoofer.example",
        "",
        "Cancel my booking.",
        "--x--",
      ].join(CRLF),
    );
    expect(await parseInboundEmail(raw)).toMatchObject({
      from: "priya@example.com",
      text: "See below.",
      attachmentCount: 1,
    });
  });

  it("files attachment-only mail with its count and no text", async () => {
    const pdf = Buffer.alloc(1_400_000, 1).toString("base64").replace(/.{76}/g, `$&${CRLF}`);
    const raw = message(
      ["From: priya@example.com", "Content-Type: multipart/mixed; boundary=x"],
      [
        "--x",
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="medical.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        pdf,
        "--x",
        "Content-Type: image/jpeg",
        "Content-Transfer-Encoding: base64",
        "",
        "/9j/4AAQSkZJRg==",
        "--x--",
      ].join(CRLF),
    );
    expect(await parseInboundEmail(raw)).toMatchObject({ text: "", attachmentCount: 2 });
  });

  /**
   * Two behaviours the library brought, pinned so a change is a decision:
   * every inline `text/plain` part is read (Apple Mail splits a reply around an
   * inline image; the in-house reader kept only the first), and a calendar
   * invite counts as a file.
   */
  it("reads every inline text part and counts a calendar invite", async () => {
    const raw = message(
      ["From: priya@example.com", "Content-Type: multipart/mixed; boundary=x"],
      [
        "--x",
        "Content-Type: text/plain",
        "",
        "Before the photo.",
        "--x",
        "Content-Type: image/png",
        "Content-Disposition: inline",
        "",
        "iVBORw0KGgo=",
        "--x",
        "Content-Type: text/plain",
        "",
        "After it.",
        "--x",
        "Content-Type: text/calendar; method=REQUEST",
        "",
        "BEGIN:VCALENDAR",
        "--x--",
      ].join(CRLF),
    );
    expect(await parseInboundEmail(raw)).toMatchObject({
      text: "Before the photo.\nAfter it.",
      attachmentCount: 2,
    });
  });

  it("carries a NUL through to the text, for the database layer to strip", async () => {
    const qp = message(
      ["From: priya@example.com", "Content-Transfer-Encoding: quoted-printable"],
      "hi=00there",
    );
    expect((await parseInboundEmail(qp)).text).toBe("hi\u0000there");
  });

  it("reads a body with no header block as text from nobody", async () => {
    await expect(parseInboundEmail("no headers at all")).resolves.toMatchObject({
      from: null,
      text: "no headers at all",
    });
  });

  it("falls back to the HTML reduced by the app's own reader, not the library's", async () => {
    const raw = message(
      ["From: priya@example.com", "Content-Type: text/html"],
      `<p>hi</p>${"<script>".repeat(50_000)}<img src=x onerror=alert(1)`,
    );
    expect((await parseInboundEmail(raw)).text).toBe("hi");
  });
});
