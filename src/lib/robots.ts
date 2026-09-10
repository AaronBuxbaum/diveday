import { LLMS_TXT_PATH } from "./public-routes";

/**
 * Site-level crawl policy, rendered by `src/app/robots.txt/route.ts`.
 *
 * This used to be Next's `robots.ts` metadata convention. It became a plain
 * text renderer on 2026-09-07 for one line: `robots.txt` is the first thing
 * an agent fetches from a host it has never seen, and the convention's typed
 * shape (`rules`, `sitemap`, `host`) has no slot for a comment pointing it at
 * `/llms.txt` (issue #1427). The format below is byte-for-byte what the
 * convention emitted, plus that one trailing comment; `e2e/seo.spec.ts` reads
 * the same `Disallow:` and `Sitemap:` lines it always did.
 *
 * The tokened surfaces (`/waivers/*`, `/ready/*`, `/recap/*`,
 * `/offline-manifest`, `/verify/*`, `/reset-password/*`, `/invite/*`,
 * `/calendar/*`, `/unsubscribe/*`, `/board/*`, `/check-in/*`) already carry per-page
 * `robots: noindex`
 * (or, for the `/calendar/*` feed route, an `X-Robots-Tag: noindex` response
 * header); disallowing their prefixes here keeps crawlers from fetching
 * bearer-token URLs at all.
 *
 * `/shop` is staff-only (the diver surfaces live under `/s/<shopSlug>` — ADR
 * 20260803-public-shop-namespace) but stays crawlable on purpose: every old
 * public URL under it 308s to its new home, and a crawler has to be allowed to
 * fetch the redirect to follow it and move the ranking across. Auth, not
 * robots, is what gates the staff surfaces themselves.
 */
export const ROBOTS_DISALLOW = [
  "/api/",
  "/waivers/",
  "/ready/",
  "/recap/",
  "/offline-manifest",
  "/verify/",
  "/reset-password/",
  "/invite/",
  "/calendar/",
  "/unsubscribe/",
  "/board/",
  "/check-in/",
] as const;

/** The policy as data, for anything that wants to reason about it rather than serve it. */
export function robotsRules(origin: string) {
  return {
    userAgent: "*",
    allow: "/",
    disallow: [...ROBOTS_DISALLOW],
    sitemap: `${origin}/sitemap.xml`,
    llms: `${origin}${LLMS_TXT_PATH}`,
  };
}

/** The `robots.txt` body. */
export function renderRobotsTxt(origin: string): string {
  const rules = robotsRules(origin);
  return [
    `User-Agent: ${rules.userAgent}`,
    `Allow: ${rules.allow}`,
    ...rules.disallow.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${rules.sitemap}`,
    "",
    `# Agents: ${rules.llms}`,
    "",
  ].join("\n");
}
