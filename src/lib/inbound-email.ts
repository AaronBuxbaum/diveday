/**
 * A minimal reading of a raw RFC 5322 message — enough to answer the four
 * questions the inbox asks of a reply (who sent it, what it answers, what it
 * says, what its subject was) and nothing else (ADR 20260907-two-way-inbox).
 *
 * In-house rather than a parsing dependency, deliberately. A full MIME parser
 * is thousands of lines for attachments, nested alternatives and every
 * encoding ever shipped; what the shop reads is the `text/plain` part of a
 * diver's reply, and this handles that shape — including the multipart
 * wrapper every mail client puts around it and the base64 or quoted-printable
 * transfer encoding it arrives in — in a page. What it does not do is stated
 * rather than approximated: an HTML-only message is reduced to its text by
 * stripping tags, an attachment is counted and never decoded, and an encoding
 * this never learned falls back to the bytes as UTF-8.
 *
 * Framework-free and pure: a string in, a record out.
 */

export type ParsedInboundEmail = {
  /** The raw `From` header, display name and all; `normalizeEmailAddress` reduces it. */
  from: string | null;
  /** Every address in `To`, raw. */
  to: string[];
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  /** The text a person typed, with the quoted history cut off. */
  text: string;
  /** Attachments seen and not decoded. */
  attachmentCount: number;
};

type Headers = Map<string, string[]>;

/** Split a message into unfolded headers and the raw body. */
function splitHeaders(raw: string): { headers: Headers; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const boundaryIndex = normalized.indexOf("\n\n");
  const headerText = boundaryIndex === -1 ? normalized : normalized.slice(0, boundaryIndex);
  const body = boundaryIndex === -1 ? "" : normalized.slice(boundaryIndex + 2);
  const headers: Headers = new Map();
  // Unfold: a line starting with whitespace continues the previous header.
  const lines = headerText.split("\n");
  let current: string | null = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current !== null) {
      current = `${current} ${line.trim()}`;
      continue;
    }
    if (current !== null) pushHeader(headers, current);
    current = line;
  }
  if (current !== null) pushHeader(headers, current);
  return { headers, body };
}

function pushHeader(headers: Headers, line: string) {
  const colon = line.indexOf(":");
  if (colon <= 0) return;
  const name = line.slice(0, colon).trim().toLowerCase();
  const value = line.slice(colon + 1).trim();
  const list = headers.get(name) ?? [];
  list.push(value);
  headers.set(name, list);
}

function header(headers: Headers, name: string): string | null {
  return headers.get(name)?.[0] ?? null;
}

/** `text/plain; charset="utf-8"` → `{ type: "text/plain", params: { charset: "utf-8" } }`. */
function parseContentType(value: string | null): {
  type: string;
  params: Record<string, string>;
} {
  if (!value) return { type: "text/plain", params: {} };
  const [type, ...rest] = value.split(";");
  const params: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const raw = part.slice(eq + 1).trim();
    params[key] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return { type: (type ?? "").trim().toLowerCase(), params };
}

/**
 * RFC 2047 encoded words in a header: `=?UTF-8?B?...?=` and `=?UTF-8?Q?...?=`.
 *
 * Whitespace *between* two adjacent encoded words is not part of either — RFC
 * 2047 §6.2 says it is ignored, and clients rely on that to split a long
 * subject at a word boundary. So it is collapsed first, before anything is
 * decoded; doing it afterwards leaves the two decoded halves with a space
 * between them that the sender never wrote.
 */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (_match, charset: string, kind: string, text: string) => {
        const bytes =
          kind.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(decodeQuotedPrintable(text.replace(/_/g, " ")), "latin1");
        return decodeBytes(bytes, charset);
      },
    );
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function decodeBytes(bytes: Buffer, charset: string | undefined): string {
  const label = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Decode one part's body by its transfer encoding and charset. */
function decodeBody(body: string, encoding: string | null, charset: string | undefined): string {
  const kind = (encoding ?? "7bit").trim().toLowerCase();
  if (kind === "base64") {
    return decodeBytes(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  }
  if (kind === "quoted-printable") {
    return decodeBytes(Buffer.from(decodeQuotedPrintable(body), "latin1"), charset);
  }
  return decodeBytes(Buffer.from(body, "latin1"), charset);
}

type Part = { headers: Headers; body: string };

function splitMultipart(body: string, boundary: string): Part[] {
  const marker = `--${boundary}`;
  const parts: Part[] = [];
  const chunks = body.split(marker);
  // chunks[0] is the preamble; the last chunk after `--` is the epilogue.
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith("--")) break;
    const trimmed = chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    parts.push(splitHeaders(trimmed));
  }
  return parts;
}

type Found = { text: string | null; html: string | null; attachments: number };

/** Walk the MIME tree collecting the first text/plain, the first text/html, and the attachment count. */
function collect(part: Part, found: Found, depth = 0): void {
  if (depth > 8) return;
  const { type, params } = parseContentType(header(part.headers, "content-type"));
  const disposition = (header(part.headers, "content-disposition") ?? "").toLowerCase();
  if (disposition.startsWith("attachment")) {
    found.attachments += 1;
    return;
  }
  if (type.startsWith("multipart/")) {
    const boundary = params.boundary;
    if (!boundary) return;
    for (const child of splitMultipart(part.body, boundary)) collect(child, found, depth + 1);
    return;
  }
  const encoding = header(part.headers, "content-transfer-encoding");
  if (type === "text/plain") {
    if (found.text === null) found.text = decodeBody(part.body, encoding, params.charset);
    return;
  }
  if (type === "text/html") {
    if (found.html === null) found.html = decodeBody(part.body, encoding, params.charset);
    return;
  }
  if (type === "message/rfc822") {
    found.attachments += 1;
    return;
  }
  // Any other leaf (an inline image, a calendar invite, a vcard) is a file.
  if (!type.startsWith("text/")) found.attachments += 1;
}

/**
 * Drop `<script>`/`<style>` **content**, which the tag strip below would
 * otherwise leave behind as text.
 *
 * A scan rather than the obvious `/<(script|style)[\s\S]*?<\/\1>/gi`,
 * because that pattern is quadratic on input that opens the tag and never
 * closes it: every unmatched `<script` re-scans to the end of the string.
 * Measured at 24.5 seconds for 1 MB of `<script>` — and this runs on a
 * message any diver holding the shop's reply address can send, whose bytes
 * are capped at MAX_INBOUND_MESSAGE_BYTES rather than at anything small. One
 * pass, no backtracking: find an opening tag, jump to its closing tag, keep
 * what is outside. An unterminated one takes the rest of the document with
 * it, which is what a browser does too.
 */
function stripRawTextElements(html: string): string {
  const lowered = html.toLowerCase();
  const opening = /<(script|style)\b/gi;
  let kept = "";
  let cursor = 0;
  for (let match = opening.exec(html); match !== null; match = opening.exec(html)) {
    const tag = match[1]?.toLowerCase();
    if (!tag) continue;
    kept += html.slice(cursor, match.index);
    const closing = lowered.indexOf(`</${tag}`, opening.lastIndex);
    // Unterminated: everything after the opening tag is that element's raw
    // text, so none of it is prose. Stop here rather than reading it as words.
    if (closing === -1) return kept;
    cursor = closing;
    opening.lastIndex = closing;
  }
  return kept + html.slice(cursor);
}

/** HTML to readable text: block breaks kept, tags dropped, entities the common five. */
export function htmlToText(html: string): string {
  return stripRawTextElements(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut the quoted history off a reply: everything from the first `>`-quoted
 * block, an "On … wrote:" attribution line, a `-----Original Message-----`
 * divider, or a `From:` header block a client pasted in. What survives is what
 * the diver typed. Nothing is cut if the cut would leave nothing — a reply
 * that is *only* quoted text is kept whole rather than filed empty.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cutAt = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (
      trimmed.startsWith(">") ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      /^On .{0,200}wrote:$/s.test(trimmed) ||
      /^El .{0,200}escribió:$/s.test(trimmed) ||
      (/^From:\s/i.test(trimmed) && /^(Sent|Date|To):\s/i.test((lines[index + 1] ?? "").trim()))
    ) {
      cutAt = index;
      break;
    }
    // A wrapped "On <date>, <name>" line whose "wrote:" landed on the next line.
    if (/^On .{0,200}$/.test(trimmed) && /^.{0,120}wrote:$/.test((lines[index + 1] ?? "").trim())) {
      cutAt = index;
      break;
    }
  }
  const kept = lines.slice(0, cutAt).join("\n").trim();
  return kept.length > 0 ? kept : text.trim();
}

/** Read the whole message. Never throws: an unreadable body yields empty text. */
export function parseInboundEmail(raw: string): ParsedInboundEmail {
  const top = splitHeaders(raw);
  const found: Found = { text: null, html: null, attachments: 0 };
  collect(top, found);
  const body = found.text ?? (found.html ? htmlToText(found.html) : "");
  const to = (top.headers.get("to") ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => decodeEncodedWords(value).trim())
    .filter((value) => value.length > 0);
  const subject = header(top.headers, "subject");
  return {
    from: decodeEncodedWords(header(top.headers, "from") ?? "") || null,
    to,
    subject: subject ? decodeEncodedWords(subject).trim() || null : null,
    messageId: header(top.headers, "message-id"),
    inReplyTo: header(top.headers, "in-reply-to"),
    text: stripQuotedReply(body),
    attachmentCount: found.attachments,
  };
}
