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
 * Hosts that are a registry or a builder's shared root, never one shop's
 * site. `allowed_domains` covers every subdomain of what it names, so pasting
 * one of these would let the call read any tenant's pages under it (security
 * review N4): `co.uk` is every British company, `wixsite.com` every Wix site.
 * A shop's own subdomain of a builder (`bluereef.wixsite.com`) is still fine.
 *
 * A short list, not the Public Suffix List: what is refused here is the shape
 * an owner might actually paste, and the cost of a miss is a wider allowance
 * of public pages, not a request from our network.
 */
export const SHARED_HOST_ROOTS: ReadonlySet<string> = new Set([
  // Second-level registries.
  ..."co.uk org.uk me.uk ltd.uk plc.uk net.uk ac.uk gov.uk".split(" "),
  ..."com.au net.au org.au co.nz org.nz co.za co.jp ne.jp or.jp co.kr".split(" "),
  ..."com.br com.mx com.ar com.co com.pe com.ph com.my com.sg com.hk com.tw com.cn".split(" "),
  ..."co.id co.th com.tr com.eg com.ec com.do com.pa com.gt co.cr co.il co.in".split(" "),
  ..."com.es com.pt com.fj com.vn com.mt com.cy gr.com".split(" "),
  // Website builders and shared hosting.
  ..."wixsite.com wix.com squarespace.com square.site weebly.com wordpress.com".split(" "),
  ..."blogspot.com blogger.com github.io gitlab.io netlify.app vercel.app pages.dev".split(" "),
  ..."webflow.io godaddysites.com carrd.co myshopify.com herokuapp.com web.app".split(" "),
  ..."firebaseapp.com azurewebsites.net cloudfront.net amazonaws.com sites.google.com".split(" "),
  ..."google.com facebook.com instagram.com linktr.ee wa.me tripadvisor.com".split(" "),
]);

/**
 * The host to allow, read from what an owner pasted, or null when it is not a
 * public web host. The host is kept exactly as pasted, `www.` included, so
 * the allowance is that host and its subdomains and nothing beside it. IP
 * addresses, single labels, ports, userinfo, non-web schemes, registries and
 * builders' shared roots ({@link SHARED_HOST_ROOTS}) are refused.
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
  if (SHARED_HOST_ROOTS.has(bare) || bare.split(".").length < 2) return null;
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
