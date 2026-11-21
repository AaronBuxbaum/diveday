import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  isUnsafeAddress,
  PrivateAddressError,
  publicOnlyLookup,
  type ResolveHost,
  resolveHost,
} from "./public-address";

/**
 * A `fetch`-shaped request over `node:http`/`node:https` that can only reach
 * public addresses, checked at connection time (issue #3267).
 *
 * Global `fetch` resolves the hostname itself and accepts no `lookup`; giving
 * it one would mean an `undici` dispatcher, a new runtime dependency. Node's
 * own client takes `lookup`, so the address check runs as the socket's
 * resolver and the socket connects to the address that was checked. TLS still
 * verifies the certificate against the hostname (SNI and `checkServerIdentity`
 * use `hostname`, not the resolved address).
 *
 * Deliberately narrow, because every caller is ours:
 * - a `string` or `URL`, `http:` or `https:` only;
 * - a body of `string` or `Uint8Array` (sent with its Content-Length — S3
 *   refuses a chunked PUT);
 * - **never follows a redirect**: a 3xx comes back as the response, the same
 *   as `redirect: "manual"`, because a redirect to an internal address is the
 *   classic way around a same-host check;
 * - a fresh connection per request (`agent: false`), so no pooled socket is
 *   reused across a later resolution. This also means no egress proxy: through
 *   a proxy, `lookup` would only ever vet the proxy's address;
 * - an idle timeout on the socket, while connecting, sending, and reading the
 *   body: a server that sends headers and then trickles nothing cannot hold a
 *   caller open. A caller's `signal` bounds the request as a whole.
 */
export type PublicFetchOptions = {
  /** How a hostname resolves; the system resolver unless a test injects one. */
  resolve?: ResolveHost;
};

// A response to these statuses has no body; `new Response()` refuses one.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function requestBody(body: RequestInit["body"]): Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  throw new TypeError("publicOnlyFetch sends only a string or Uint8Array body");
}

function responseHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  return headers;
}

function requestUrl(input: URL | RequestInfo): URL {
  if (typeof input !== "string" && !(input instanceof URL)) {
    throw new TypeError("publicOnlyFetch takes a string or URL, not a Request");
  }
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`publicOnlyFetch refuses ${url.protocol}`);
  }
  return url;
}

/** "[::1]" → "::1": Node wants the bare address. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

/**
 * The public-only `fetch`: `publicOnlyLookup` as the socket's resolver, plus
 * the literal-IP check Node's skipped `lookup` would otherwise miss.
 */
export function publicOnlyFetch(options: PublicFetchOptions = {}): typeof fetch {
  const send = fetchOverNode(publicOnlyLookup(options.resolve ?? resolveHost));
  const guarded = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const hostname = bareHostname(requestUrl(input));
    if (isIP(hostname) && isUnsafeAddress(hostname)) throw new PrivateAddressError();
    return send(input, init);
  };
  return guarded as typeof fetch;
}

/**
 * The transport under `publicOnlyFetch`, with whatever socket resolver it is
 * given. Exported for its own tests, which point it at a local server; any
 * other caller wants `publicOnlyFetch`.
 */
const IDLE_TIMEOUT_MS = 30_000;

export function fetchOverNode(
  lookup: LookupFunction,
  options: { idleTimeoutMs?: number } = {},
): typeof fetch {
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const send = async (input: URL | RequestInfo, init: RequestInit = {}): Promise<Response> => {
    const url = requestUrl(input);
    const hostname = bareHostname(url);

    const body = requestBody(init.body);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    if (body) headers["content-length"] = String(body.byteLength);

    const client = url.protocol === "https:" ? https : http;
    return new Promise<Response>((resolve, reject) => {
      const request = client.request(
        {
          protocol: url.protocol,
          hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? "GET",
          headers,
          lookup,
          agent: false,
          signal: init.signal ?? undefined,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          try {
            const responseBody = NULL_BODY_STATUSES.has(status)
              ? null
              : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
            if (responseBody === null) response.resume();
            resolve(
              new Response(responseBody, {
                status,
                statusText: response.statusMessage,
                headers: responseHeaders(response.headers),
              }),
            );
          } catch (error) {
            response.destroy();
            reject(error);
          }
        },
      );
      request.setTimeout(idleTimeoutMs, () => {
        request.destroy(new Error("The connection went idle"));
      });
      request.on("error", reject);
      request.end(body);
    });
  };

  return send as typeof fetch;
}
