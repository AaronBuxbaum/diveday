import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeMessage } from "./provider";

/**
 * **What a Claude call said, as text DiveDay may keep for 30 days** (Aaron,
 * 2026-10-23; ADR 20261023-claude-call-content). The founder
 * reads it by SQL to find out why an assist answered what it did; the row is
 * `claude_call_content` (`src/db/schema/assists.ts`).
 *
 * **No image or document is ever kept.** Every image and document block
 * becomes a one-line placeholder naming its media type and size, and its
 * bytes (base64, a link, a file id) never reach the returned text. A block
 * this file does not recognise is a placeholder too, never `JSON.stringify`:
 * an unknown shape is exactly where a payload would hide.
 *
 * **A fetched page is a URL, never its body.** `web_fetch` reads the shop's own
 * site, but a page can quote anything, runs to 20,000 tokens, and is a click
 * away for whoever reads the log, so only the list of URLs is kept.
 */
export type CallTranscript = {
  /** The feature's fixed instructions. */
  readonly system: string;
  /** The cached shop context, when the call carried one. */
  readonly context: string | null;
  /** The per-request content, with every image and document as a placeholder. */
  readonly content: string;
  /** The model's last text block as it came back: what was parsed. Null with no answer. */
  readonly answer: string | null;
  /** The pages `web_fetch` asked for, in order, one per line. Null when none. */
  readonly fetchedUrls: string | null;
};

/** At most this many URLs are kept, each at most this long. */
const MAX_FETCHED_URLS = 50;
const MAX_URL_LENGTH = 2_048;

/** A media type as an API names one; anything else reads as `unknown`. */
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9.+-]{1,64}$/;

/** A byte count the way a person reads one: `300 B`, `812 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How many bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
  const length = data.length;
  if (length === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

function mediaTypeOf(source: { media_type?: unknown }): string {
  const value = source.media_type;
  return typeof value === "string" && MEDIA_TYPE.test(value) ? value : "unknown";
}

type SourceShape = { type?: unknown; media_type?: unknown; data?: unknown };

/** `image/jpeg, 812 KB`, or how the bytes were given when they were not inline. */
function describeSource(source: SourceShape | undefined, fallbackType: string): string {
  if (!source || typeof source !== "object") return fallbackType;
  if (source.type === "base64" || source.type === "text") {
    const data = typeof source.data === "string" ? source.data : "";
    const bytes = source.type === "base64" ? base64Bytes(data) : data.length;
    const mediaType = source.type === "text" ? "text/plain" : mediaTypeOf(source);
    return `${mediaType}, ${formatBytes(bytes)}`;
  }
  if (source.type === "url") return `${fallbackType}, from a link`;
  if (source.type === "file") return `${fallbackType}, from a stored file`;
  if (source.type === "content") return `${fallbackType}, as blocks`;
  return fallbackType;
}

/** One block of what was sent, as text: its words, or a placeholder. */
function renderBlock(block: Anthropic.ContentBlockParam): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return `[image: ${describeSource(block.source as SourceShape, "image")}, not kept]`;
    case "document":
      return `[document: ${describeSource(block.source as SourceShape, "document")}, not kept]`;
    default:
      return `[${typeof block.type === "string" ? block.type.slice(0, 64) : "unknown"} block, not kept]`;
  }
}

/** The per-request content as text, every image and document a placeholder. */
export function renderContent(content: string | readonly Anthropic.ContentBlockParam[]): string {
  if (typeof content === "string") return content;
  return content.map(renderBlock).join("\n\n");
}

/** The last text block of a response: what `callStructured` parses. */
export function finalText(message: ClaudeMessage): string | null {
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const block = message.content[index];
    if (block?.type === "text") return block.text;
  }
  return null;
}

/** The URLs `web_fetch` was asked for across every turn, in order, deduplicated. */
export function fetchedUrls(messages: readonly ClaudeMessage[]): string | null {
  const urls: string[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== "server_tool_use" || block.name !== "web_fetch") continue;
      const url = (block.input as { url?: unknown } | null)?.url;
      if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) continue;
      if (/\s/.test(url) || urls.includes(url)) continue;
      urls.push(url);
      if (urls.length >= MAX_FETCHED_URLS) return urls.join("\n");
    }
  }
  return urls.length > 0 ? urls.join("\n") : null;
}

/** The Anthropic request id a response carries, when it is a plausible one. */
export function requestIdOf(message: ClaudeMessage): string | null {
  return plausibleRequestId((message as { _request_id?: unknown })._request_id);
}

/** `req_…`-shaped and short, or null: never a string a provider could fill with words. */
export function plausibleRequestId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}
