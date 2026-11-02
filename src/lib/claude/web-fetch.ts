import type Anthropic from "@anthropic-ai/sdk";
import { getDomain } from "tldts";

/**
 * **Reading a shop's own website** through Claude's server-side `web_fetch`
 * tool (ADR 20261018-claude-assists). Anthropic's servers fetch the page;
 * DiveDay's servers never do, so a pasted URL can never point our own network
 * at an internal address.
 *
 * The tool is restricted to one host, the one the owner pasted. A page that
 * links elsewhere, or text on it that asks Claude to fetch something else, is
 * refused by the API's `allowed_domains`, not by trusting the model.
 * `web_fetch_20260209` runs on Sonnet 5.5, not Haiku 5.5, so a website assist
 * uses the `draft` model.
 */

/**
 * Hosts a DNS name can end in that are never a shop's public website: private
 * and LAN names, and the special-use names of RFC 6761, RFC 7686 and RFC 9476.
 */
const PRIVATE_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".example",
  ".onion",
  ".alt",
  ".arpa",
];

/**
 * Shared services that are one ordinary domain, not a public suffix, so the
 * Public Suffix List does not name them, yet whose root holds many unrelated
 * sites or profiles. Matched exactly: a shop's own subdomain
 * (`bluereef.squarespace.com`) is still fine.
 */
export const SHARED_SERVICE_ROOTS: ReadonlySet<string> = new Set([
  ..."wix.com squarespace.com weebly.com wordpress.com blogger.com godaddysites.com".split(" "),
  ..."amazonaws.com sites.google.com google.com facebook.com instagram.com".split(" "),
  ..."linktr.ee wa.me tripadvisor.com".split(" "),
]);

/**
 * Whether a host is a registry or a builder's shared root, never one shop's
 * site. `allowed_domains` covers every subdomain of what it names, so pasting
 * one of these would let the call read any tenant's pages under it (security
 * review N4): `co.uk` is every British company, `wixsite.com` every Wix site.
 * Registries and hosting platforms come from the Public Suffix List, private
 * section included (`tldts`, ADR 20261102-public-suffix-list); a host that is
 * itself a suffix, wildcard rules included, has no registrable domain.
 */
function isSharedRoot(host: string): boolean {
  if (SHARED_SERVICE_ROOTS.has(host)) return true;
  return getDomain(host, { allowPrivateDomains: true, extractHostname: false }) === null;
}

/**
 * The host to allow, read from what an owner pasted, or null when it is not a
 * public web host. The host is kept exactly as pasted, `www.` included, so
 * the allowance is that host and its subdomains and nothing beside it. IP
 * addresses, single labels, ports, userinfo, non-web schemes, public suffixes
 * and shared services' roots are refused; one leading `www.` is set aside
 * only for that last check.
 */
export function allowedFetchHost(pasted: string): string | null {
  const trimmed = pasted.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // IPv6 literals arrive bracketed; IPv4, in any form, is normalized to four numeric labels.
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/.test(label))) return null;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  if (bare.split(".").length < 2 || isSharedRoot(bare)) return null;
  return host;
}

export type WebFetchLimits = {
  /** Fetches allowed in one request. */
  readonly maxUses?: number;
  /** Approximate cap on the text one fetched page adds to the prompt. */
  readonly maxContentTokens?: number;
};

/** The `web_fetch` tool restricted to one shop's host, or null when the host is refused. */
export function webFetchTool(
  pastedSite: string,
  limits: WebFetchLimits = {},
): Anthropic.WebFetchTool20260209 | null {
  const host = allowedFetchHost(pastedSite);
  if (!host) return null;
  return {
    type: "web_fetch_20260209",
    name: "web_fetch",
    allowed_domains: [host],
    max_uses: limits.maxUses ?? 8,
    max_content_tokens: limits.maxContentTokens ?? 20_000,
  };
}
