import type Anthropic from "@anthropic-ai/sdk";

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
 * The host to allow, read from what an owner pasted, or null when it is not a
 * public web host. A leading `www.` is dropped (the allowance covers
 * subdomains); anything else stays whole, so `bluereef.wixsite.com` never
 * widens to all of `wixsite.com`. IP addresses, single labels, ports, userinfo
 * and non-web schemes are refused.
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
  return bare.split(".").length >= 2 ? bare : null;
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
