import type { MetadataRoute } from "next";
import { publicAppUrl } from "@/lib/notifications";

/**
 * Site-level crawl policy. The tokened surfaces (`/waivers/*`, `/ready/*`,
 * `/recap/*`, `/offline-manifest`, `/verify/*`, `/reset-password/*`,
 * `/invite/*`, `/calendar/*`, `/unsubscribe/*`) already carry per-page
 * `robots: noindex` (or, for the `/calendar/*` feed route, an
 * `X-Robots-Tag: noindex` response header); disallowing their prefixes here
 * keeps crawlers from fetching bearer-token URLs at all. Staff routes under
 * `/shop` stay crawlable because the same prefix serves each shop's public
 * schedule and course pages — auth, not robots, is what gates the staff
 * surfaces.
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
