import PostalMime, { addressParser, type Email, type PostalMimeOptions } from "postal-mime";
import { log } from "@/lib/log";

/**
 * What the inbox reads off a raw RFC 5322 reply: who sent it, what it answers,
 * what it says, what its subject was, and how many files came with it (ADR
 * 20260907-two-way-inbox).
 *
 * The MIME work — header unfolding, RFC 2047 words, base64 and quoted-printable,
 * charsets, the multipart tree — is PostalMime's (ADR 20261102-postal-mime-inbound-reader).
 * What stays here is the app's own policy, each piece stated rather than
 * inherited from the library's defaults:
 *
 * - **Never rejects.** A library refusal (a limit, a malformed tree) and a
 *   message over {@link MAX_INBOUND_MESSAGE_BYTES} both come back as
 *   {@link UNREADABLE}: no sender, no text, nothing to file. The route drops
 *   that as `empty`, which is what an unreadable body always was here.
 * - **One sender or none.** A second `From:` header, a second mailbox in one, or
 *   a group yields `from: null`; which of two senders a provider's DMARC
 *   verdict vouched for is not something to guess.
 * - **No control character leaves a header.** `Message-ID` and `In-Reply-To`
 *   go back out in a staff reply's own headers, so they are read raw (never
 *   RFC 2047-decoded) and one carrying a control character is dropped, not
 *   cleaned; the subject has them replaced with spaces.
 * - **The text a person typed.** The inline `text/plain` parts, or the HTML
 *   reduced by {@link htmlToText} when there are none, with the quoted history
 *   cut.
 * - **Files are counted.** A forwarded `message/rfc822` is one file, never
 *   parsed inline into the reply's text.
 *
 * Framework-free: a string in, a record out.
 */

export type ParsedInboundEmail = {
  /** The one `From` mailbox's address, or null when there is not exactly one. */
  from: string | null;
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  /** The text a person typed, with the quoted history cut off. */
  text: string;
  /** Attachments seen; their bytes are not kept. */
  attachmentCount: number;
};

/**
 * SES refuses messages over 40 MB, and a reply a person typed is a few KB.
 * The cap bounds what one webhook call will pull through memory: the S3 read
 * refuses past it by declared and by measured length
 * (`src/lib/notifications/inbound-mail-store.ts`), and this refuses past it
 * again before parsing, so the bound holds for any caller.
 */
export const MAX_INBOUND_MESSAGE_BYTES = 2 * 1024 * 1024;

/** The refusal: nothing a route could file or attribute. */
const UNREADABLE: ParsedInboundEmail = {
  from: null,
  subject: null,
  messageId: null,
  inReplyTo: null,
  text: "",
  attachmentCount: 0,
};

/**
 * The library's limits, set tighter than its defaults for a diver's reply under
 * a 2 MiB cap. Exceeding one rejects the parse, which is {@link UNREADABLE}.
 */
const PARSER_OPTIONS: PostalMimeOptions = {
  // A forwarded message is a file the shop can open, not more of the reply.
  forceRfc822Attachments: true,
  maxRfc822NestingDepth: 0,
  // Real mail nests three or four deep (mixed › related › alternative).
  maxNestingDepth: 16,
  // A reply with a thousand parts is not a reply, and ten thousand empty ones
  // fit in seventy kilobytes.
  maxPartCount: 1000,
  maxHeadersSize: 256 * 1024,
  // The library's default, spelled out: no base64 string copy of each file.
  attachmentEncoding: "arraybuffer",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

function rawHeaders(email: Email, key: string): string[] {
  return email.headers.filter((header) => header.key === key).map((header) => header.value);
}

/** A header that goes back out in ours: its first value raw, or null if it carries a control character. */
function threadingHeader(email: Email, key: string): string | null {
  const value = rawHeaders(email, key)[0]?.trim();
  if (!value || CONTROL_CHARACTER.test(value)) return null;
  return value;
}

/** The address of the one mailbox in the one `From` header. */
function singleSender(email: Email): string | null {
  const values = rawHeaders(email, "from");
  if (values.length !== 1) return null;
  const mailboxes = addressParser(values[0] ?? "");
  const only = mailboxes.length === 1 ? mailboxes[0] : undefined;
  if (!only || only.group !== undefined) return null;
  const address = only.address.trim();
  return address.length > 0 && !CONTROL_CHARACTER.test(address) ? address : null;
}

function cleanSubject(subject: string | undefined): string | null {
  if (!subject) return null;
  return subject.replace(CONTROL_CHARACTERS, " ").trim() || null;
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

/**
 * Drop every tag, and anything that *starts* one and never finishes.
 *
 * A scan rather than `.replace(/<[^>]+>/g, "")` for the second half of that
 * sentence: the regex leaves a trailing `<script` — a `<` with no `>` after
 * it — sitting in the output as ordinary text, which is a live element the
 * moment anything treats this string as markup. A browser reads an
 * unterminated tag as running to the end of the document, and so does this,
 * which makes the result total: no `<` survives that opened a tag.
 */
function stripTags(html: string): string {
  let text = "";
  let cursor = 0;
  for (;;) {
    const open = html.indexOf("<", cursor);
    if (open === -1) return text + html.slice(cursor);
    text += html.slice(cursor, open);
    const close = html.indexOf(">", open + 1);
    if (close === -1) return text;
    cursor = close + 1;
  }
}

/**
 * The five named entities and the numeric apostrophe, in **one** pass.
 *
 * Six chained `.replace` calls unescape each other's output: `&amp;lt;` — a
 * sender writing a literal `&lt;` — becomes `&lt;` on the first and then `<`
 * on the third, so the text says something they did not. One alternation
 * consumes each entity exactly once and never looks at what it produced.
 */
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:nbsp|amp|lt|gt|quot|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
}

/** HTML to readable text: block breaks kept, tags dropped, entities the common five. */
export function htmlToText(html: string): string {
  const withoutTags = stripTags(
    stripRawTextElements(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n"),
  );
  return decodeEntities(withoutTags)
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

/** Read the whole message. Never rejects: an unreadable one is {@link UNREADABLE}. */
export async function parseInboundEmail(raw: string): Promise<ParsedInboundEmail> {
  if (Buffer.byteLength(raw, "utf8") > MAX_INBOUND_MESSAGE_BYTES) {
    log("email_inbound.unreadable", "warn", { reason: "too_large" });
    return UNREADABLE;
  }
  let email: Email;
  try {
    email = await PostalMime.parse(raw, PARSER_OPTIONS);
  } catch (error) {
    // The library's error code only (`EMAXPARTCOUNT` and kin), never the message's words.
    const code = (error as { code?: unknown } | null)?.code;
    log("email_inbound.unreadable", "warn", {
      reason: typeof code === "string" ? code : "parse_failed",
    });
    return UNREADABLE;
  }
  const body = email.text ?? (email.html ? htmlToText(email.html) : "");
  return {
    from: singleSender(email),
    subject: cleanSubject(email.subject),
    messageId: threadingHeader(email, "message-id"),
    inReplyTo: threadingHeader(email, "in-reply-to"),
    text: stripQuotedReply(body),
    attachmentCount: email.attachments.length,
  };
}
