import { isIP } from "node:net";
import {
  isPrivateAddressError,
  isUnsafeAddress,
  type ResolvedAddress,
  type ResolveHost,
  resolveHost,
} from "@/lib/net/public-address";
import { publicOnlyFetch } from "@/lib/net/public-fetch";
import { type ImageUpload, isManagedStorageUrl, type StoredImage } from "./index";
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

type Fetch = typeof fetch;

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
  options: {
    fetchImpl?: Fetch;
    lookup?: ResolveHost;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<IngestResult> {
  if (rawUrl.startsWith("/")) return { status: "unchanged", url: rawUrl };
  if (isManagedStorageUrl(rawUrl, options.env ?? process.env)) {
    return { status: "unchanged", url: rawUrl };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "blocked" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { status: "blocked" };

  // Browser tests exercise our full Next/database stack, but must not wait on or depend on a
  // live third-party host — this is the same guard marine-forecast.ts and analytics.ts already
  // check, extended here so a staff-pasted image URL can't make the e2e fleet perform a real DNS
  // lookup (previously ungated: DIVEDAY_DISABLE_EXTERNAL_HTTP was set in every e2e worker's env
  // but nothing here read it). A literal IP is exempt: `dns.lookup()` resolves those synchronously
  // with no network round-trip regardless, which is exactly why the CR-020 SSRF e2e test
  // (dive-sites.spec.ts) uses a loopback literal — it wants the *real* isUnsafeAddress check to
  // run, not a stubbed-out one. Passing an explicit `lookup` still exercises the real code path
  // in unit tests.
  const lookup = options.lookup ?? resolveHost;
  if (
    process.env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" &&
    lookup === resolveHost &&
    !isIP(parsed.hostname)
  ) {
    return { status: "failed" };
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(parsed.hostname);
  } catch {
    return { status: "failed" };
  }
  if (addresses.length === 0) return { status: "failed" };
  // The early answer: refuse before opening any connection. It is not the
  // guard against DNS rebinding — a second resolution can answer differently.
  // That guard is the default transport, which checks the address it actually
  // connects to (issue #3267).
  if (addresses.some(({ address }) => isUnsafeAddress(address))) return { status: "blocked" };

  const fetchImpl = options.fetchImpl ?? publicOnlyFetch({ resolve: lookup });
  // One budget for the whole download, headers and body alike: a server that
  // answers promptly and then trickles the body must not hold the save open.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  let bytes: ArrayBuffer | null;
  try {
    try {
      response = await fetchImpl(parsed.toString(), {
        // Never auto-follow — a redirect to an internal address is the classic
        // SSRF bypass for a same-host-validated URL.
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "DiveDayImageIngest/1.0" },
      });
    } catch (error) {
      return isPrivateAddressError(error) ? { status: "blocked" } : { status: "failed" };
    }
    // An unread body would hold the connection open; release it on every refusal.
    const release = async () => {
      await response.body?.cancel().catch(() => undefined);
    };
    if (response.status >= 300 && response.status < 400) {
      await release();
      return { status: "blocked" };
    }
    if (!response.ok) {
      await release();
      return { status: "failed" };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      await release();
      return { status: "failed" };
    }
    try {
      bytes = await readBounded(response, MAX_IMAGE_BYTES);
    } catch {
      return { status: "failed" };
    }
  } finally {
    clearTimeout(timeout);
  }
  if (bytes === null) return { status: "failed" };

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const filename = parsed.pathname.split("/").filter(Boolean).pop() ?? "image";

  const stored = await store({ filename, contentType, bytes });
  if (stored.status === "not_configured") return { status: "not_configured" };
  if (stored.status !== "stored") return { status: "failed" };
  return { status: "stored", url: stored.url };
}
