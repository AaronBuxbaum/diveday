import type { MetadataRoute } from "next";
import { publicAppUrl } from "@/lib/notifications";

/**
 * Site-level crawl policy. The tokened surfaces (`/waivers/*`, `/ready/*`,
 * `/recap/*`, `/offline-manifest`, `/verify/*`, `/reset-password/*`,
 * `/invite/*`, `/calendar/*`, `/unsubscribe/*`) already carry per-page
 * `robots: noindex` (or, for the `/calendar/*` feed route, an
 * `X-Robots-Tag: noindex` response header); disallowing their prefixes here
 * keeps crawlers from fetching bearer-token URLs at all.
 *
 * `/shop` is now staff-only (the diver surfaces live under `/s/<shopSlug>` —
 * ADR 20260803-public-shop-namespace) but stays crawlable on purpose: every
 * old public URL under it 308s to its new home, and a crawler has to be
 * allowed to fetch the redirect to follow it and move the ranking across.
 * Auth, not robots, is what gates the staff surfaces themselves.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = publicAppUrl() ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
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
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
