import type Anthropic from "@anthropic-ai/sdk";
import { parse } from "tldts";

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

/** Hosts a DNS name can end in that are never a shop's public website. */
const PRIVATE_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
];

/**
 * Shared services that are not public suffixes, so the Public Suffix List
 * cannot know them: a builder's or a social network's own domain. Pasting
 * `wix.com` would let `allowed_domains` read every page under it. A shop's own
 * subdomain (`bluereef.wix.com`) is still fine. Registries (`co.uk`) and
 * hosted platforms (`wixsite.com`, `github.io`) are suffixes and come from
 * `tldts` instead (ADR 20261102-website-assist-public-suffix-list).
 */
export const SHARED_SERVICE_ROOTS: ReadonlySet<string> = new Set(
  "wix.com squarespace.com weebly.com wordpress.com blogger.com godaddysites.com amazonaws.com sites.google.com google.com facebook.com instagram.com linktr.ee wa.me tripadvisor.com".split(
    " ",
  ),
);

/**
 * The host to allow, read from what an owner pasted, or null when it is not a
 * public web host. The host is kept exactly as pasted, `www.` included, so
 * the allowance is that host and its subdomains and nothing beside it. IP
 * addresses, single labels, ports, userinfo, non-web schemes, public suffixes (registries and
 * platforms' shared roots) and {@link SHARED_SERVICE_ROOTS} are refused.
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
  // IPv6 literals arrive bracketed; IPv4 is four numeric labels.
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/.test(label))) return null;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  if (SHARED_SERVICE_ROOTS.has(bare)) return null;
  // `domain` is null when the host is itself a public suffix: a registry, a
  // wildcard suffix, or a platform's shared root.
  if (parse(bare, { allowPrivateDomains: true }).domain === null) return null;
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
