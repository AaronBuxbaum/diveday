import { lookup as dnsLookup } from "node:dns/promises";
import { type ImageUpload, isManagedBlobUrl, type StoredImage } from "./index";
import { MAX_IMAGE_BYTES } from "./limits";

/**
 * Fetches a staff-pasted third-party image URL once, server-side, and hands
 * the bytes to the same validate/decode/strip-metadata/re-encode/store
 * pipeline every direct upload already goes through (`storeImage` in
 * `./index.ts`) — so the resulting first-party URL is what a public page
 * renders, and the third-party host never sees a visitor's IP or referrer
 * (CR-020). A root-relative path or an already-managed blob URL passes
 * through untouched; anything else that isn't a plain http(s) URL, resolves
 * to a private/reserved address, redirects, or fails validation is rejected
 * — never silently kept as the raw external URL.
 */

export type IngestResult =
  | { status: "stored"; url: string }
  | { status: "unchanged"; url: string }
  | { status: "blocked" }
  | { status: "not_configured" }
  | { status: "failed" };

type DnsAddress = { address: string; family: number };
export type DnsLookup = (hostname: string) => Promise<DnsAddress[]>;
type Fetch = typeof fetch;

async function defaultLookup(hostname: string): Promise<DnsAddress[]> {
  const result = await dnsLookup(hostname, { all: true });
  return result;
}

/** IPv4 loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, and reserved/test/multicast ranges. */
function isUnsafeIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true; // malformed — refuse rather than guess
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
  return false;
}

/** IPv6 loopback, unique-local, link-local, and IPv4-mapped addresses (checked against the v4 rules). */
function isUnsafeIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isUnsafeIPv4(mapped[1]);
  return false;
}

/** Reads the response body up to `maxBytes`, aborting the stream early rather than trusting Content-Length alone. */
async function readBounded(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

const FETCH_TIMEOUT_MS = 10_000;

export async function ingestImageUrl(
  rawUrl: string,
  store: (upload: Omit<ImageUpload, "keyPrefix">) => Promise<StoredImage>,
  options: { fetchImpl?: Fetch; lookup?: DnsLookup } = {},
): Promise<IngestResult> {
  if (rawUrl.startsWith("/")) return { status: "unchanged", url: rawUrl };
  if (isManagedBlobUrl(rawUrl)) return { status: "unchanged", url: rawUrl };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "blocked" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { status: "blocked" };

  const lookup = options.lookup ?? defaultLookup;
  let addresses: DnsAddress[];
  try {
    addresses = await lookup(parsed.hostname);
  } catch {
    return { status: "failed" };
  }
  if (addresses.length === 0) return { status: "failed" };
  for (const { address, family } of addresses) {
    if (family === 6 ? isUnsafeIPv6(address) : isUnsafeIPv4(address)) {
      return { status: "blocked" };
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      // Never auto-follow — a redirect to an internal address is the classic
      // SSRF bypass for a same-host-validated URL.
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "DiveDayImageIngest/1.0" },
    });
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
  if (response.status >= 300 && response.status < 400) return { status: "blocked" };
  if (!response.ok) return { status: "failed" };

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    return { status: "failed" };
  }

  const bytes = await readBounded(response, MAX_IMAGE_BYTES);
  if (bytes === null) return { status: "failed" };

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const filename = parsed.pathname.split("/").filter(Boolean).pop() ?? "image";

  const stored = await store({ filename, contentType, bytes });
  if (stored.status === "not_configured") return { status: "not_configured" };
  if (stored.status !== "stored") return { status: "failed" };
  return { status: "stored", url: stored.url };
}
