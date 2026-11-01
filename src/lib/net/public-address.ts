import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

/**
 * Which network addresses an outbound request on behalf of a shop may reach:
 * public unicast only. Shared by every server-side fetch of a URL that staff
 * typed (a pasted image URL, a backup endpoint), because each one is
 * server-side request forgery surface (CR-020, issue #3267).
 *
 * Checking a name once and then letting the HTTP client resolve it again is a
 * check-then-connect race: a DNS server that answers public first and private
 * second (DNS rebinding) gets the request through. `publicOnlyLookup` closes
 * that gap by being the socket's own resolver, so the address the socket
 * connects to is the address that was checked.
 */

export type ResolvedAddress = { address: string; family: number };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

/** The code carried by every refusal, so a caller can tell it from a network failure. */
export const PRIVATE_ADDRESS_ERROR_CODE = "EPRIVATEADDRESS";

/** A destination that resolved to (or is) an address this app must not reach. */
export class PrivateAddressError extends Error {
  readonly code = PRIVATE_ADDRESS_ERROR_CODE;
  constructor() {
    super("The destination is not a public address");
    this.name = "PrivateAddressError";
  }
}

export function isPrivateAddressError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PRIVATE_ADDRESS_ERROR_CODE
  );
}

/**
 * `dns.lookup()` takes no `AbortSignal` and, against a hostname the resolver
 * can't reach, can hang far longer than any caller's request budget.
 */
const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/** The system resolver, every address, bounded in time. */
export async function resolveHost(hostname: string): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dnsLookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** IPv4 loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, and reserved/test/multicast ranges. */
export function isUnsafeIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return true; // malformed — refuse rather than guess
  }
  const [a, b, c] = parts.map(Number);
  if ([a, b, c, Number(parts[3])].some((part) => part > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast (deprecated)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
  return false;
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function parseIPv6(ip: string): number[] | null {
  let text = ip;
  const groups: number[] = [];
  // A trailing dotted quad ("::ffff:127.0.0.1") is the last two groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let tail: number[] = [];
  if (dotted) {
    const quad = dotted[2].split(".").map(Number);
    if (quad.some((part) => part > 255)) return null;
    tail = [(quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]];
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (half: string) => (half === "" ? [] : half.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  for (const group of [...head, ...rest]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
  }
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1 && explicit !== 8) return null;
  if (halves.length === 2 && explicit > 7) return null;
  groups.push(...head.map((group) => Number.parseInt(group, 16)));
  for (let i = explicit; i < 8; i++) groups.push(0);
  groups.push(...rest.map((group) => Number.parseInt(group, 16)), ...tail);
  return groups;
}

function embeddedIPv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Anything outside global unicast (2000::/3) — loopback, unspecified,
 * unique-local, link-local, site-local, multicast — plus the documentation
 * ranges and 2001::/23 (Teredo and other protocol assignments). An address that carries an IPv4 address inside it
 * (IPv4-mapped, IPv4-translated, NAT64, 6to4) is judged by that address, so
 * "::ffff:127.0.0.1" and "::ffff:7f00:1" are both loopback.
 */
export function isUnsafeIPv6(ip: string): boolean {
  const groups = parseIPv6(ip.split("%")[0] ?? "");
  if (!groups) return true; // malformed — refuse rather than guess
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const zeroTo = (end: number) => groups.slice(0, end).every((group) => group === 0);
  // ::ffff:0:0/96 (mapped) and ::ffff:0:0:0/96 (translated).
  if (zeroTo(5) && g5 === 0xffff) return isUnsafeIPv4(embeddedIPv4(g6, g7));
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return isUnsafeIPv4(embeddedIPv4(g6, g7));
  // 64:ff9b::/96, the well-known NAT64 prefix.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isUnsafeIPv4(embeddedIPv4(g6, g7));
  }
  if ((g0 & 0xe000) !== 0x2000) return true; // not global unicast
  // 2001::/23 is IETF protocol assignments (Teredo, benchmarking, ORCHID and
  // the like), none of them a storage endpoint; 2001:db8::/32 is documentation.
  if (g0 === 0x2001 && (g1 < 0x200 || g1 === 0xdb8)) return true;
  if (g0 === 0x3fff && g1 < 0x1000) return true; // documentation (3fff::/20)
  if (g0 === 0x2002) return isUnsafeIPv4(embeddedIPv4(g1, g2)); // 6to4
  return false;
}

/** Whether an address (either family, as text) is one this app must not reach. Not an IP at all counts as unsafe. */
export function isUnsafeAddress(address: string): boolean {
  const bare = address.replace(/^\[(.*)\]$/, "$1");
  const family = isIP(bare.split("%")[0] ?? "");
  if (family === 4) return isUnsafeIPv4(bare);
  if (family === 6) return isUnsafeIPv6(bare);
  return true;
}

type LookupDecision =
  | { error: Error }
  | { all: ResolvedAddress[] }
  | { address: string; family: number };

function notFound(hostname: string): Error {
  return Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" });
}

function decide(
  hostname: string,
  answers: ResolvedAddress[],
  options: { family?: number | string; all?: boolean },
): LookupDecision {
  if (answers.length === 0) return { error: notFound(hostname) };
  if (answers.some(({ address }) => isUnsafeAddress(address))) {
    return { error: new PrivateAddressError() };
  }
  const family =
    options.family === 4 || options.family === "IPv4"
      ? 4
      : options.family === 6 || options.family === "IPv6"
        ? 6
        : 0;
  const wanted = family ? answers.filter((answer) => answer.family === family) : answers;
  const [first] = wanted;
  if (!first) return { error: notFound(hostname) };
  return options.all ? { all: wanted } : { address: first.address, family: first.family };
}

/**
 * A `lookup` for `net`/`http`/`https` that resolves through `resolve` and
 * fails with `PrivateAddressError` when any answer is unsafe — one bad answer
 * refuses the whole name, so the client can't fall back onto it. The socket
 * then connects to exactly the addresses this function returned.
 *
 * Node skips `lookup` for a literal IP host, so a caller must check a literal
 * itself (`publicOnlyFetch` does).
 *
 * The callback runs on its own tick, outside the promise chain, the way
 * `dns.lookup` calls back: a throw from inside `net` stays an ordinary
 * exception instead of becoming an unhandled rejection.
 */
export function publicOnlyLookup(resolve: ResolveHost = resolveHost): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then(
        (answers) => decide(hostname, answers, options),
        (error: unknown): LookupDecision => ({
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      )
      .then((decision) => {
        process.nextTick(() => {
          if ("error" in decision) callback(decision.error, "");
          else if ("all" in decision) callback(null, decision.all);
          else callback(null, decision.address, decision.family);
        });
      });
  };
}
