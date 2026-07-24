import { resolveDiveSiteImageUrl } from "@/lib/dive-site-media";
import { storeDiveSiteImage } from "./index";
import { ingestImageUrl } from "./ingest-url";

/**
 * A public dive-site page previously rendered `satelliteImageUrl`,
 * `routeImageUrl`, and the `imageUrls` gallery as whatever URL staff pasted
 * — a staff-selected third-party host could observe every visitor's IP and
 * referrer on every page view (CR-020). This is the one place staff-submitted
 * dive-site media becomes first-party: known bundled Commons attribution
 * photos keep resolving to their local path (`resolveDiveSiteImageUrl`);
 * anything else is fetched once server-side and re-stored
 * (`ingestImageUrl` + `storeDiveSiteImage`), with the same SSRF/size/format
 * defenses every other upload gets.
 */

type OneResult = { ok: true; url?: string } | { ok: false; reason: "not_configured" | "rejected" };

async function ingestOne(url: string | undefined): Promise<OneResult> {
  if (!url) return { ok: true, url: undefined };
  const bundled = resolveDiveSiteImageUrl(url);
  if (bundled?.startsWith("/")) return { ok: true, url: bundled };
  const result = await ingestImageUrl(url, storeDiveSiteImage);
  if (result.status === "stored" || result.status === "unchanged") {
    return { ok: true, url: result.url };
  }
  if (result.status === "not_configured") return { ok: false, reason: "not_configured" };
  return { ok: false, reason: "rejected" };
}

export type DiveSiteMediaInput = {
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls: string[];
};

export type DiveSiteMediaResult =
  | { ok: true; satelliteImageUrl?: string; routeImageUrl?: string; imageUrls: string[] }
  | { ok: false; reason: "not_configured" | "rejected" };

/**
 * Fails the whole save rather than silently keeping any raw external URL.
 * Distinguishes "not_configured" (no Blob token set for this deployment —
 * an operator/config gap, not a bad URL) from "rejected" (malformed,
 * blocked by the SSRF checks, or too large) so the save form can show a
 * meaningfully different message for each.
 */
export async function ingestDiveSiteMedia(input: DiveSiteMediaInput): Promise<DiveSiteMediaResult> {
  const [satellite, route, ...gallery] = await Promise.all([
    ingestOne(input.satelliteImageUrl),
    ingestOne(input.routeImageUrl),
    ...input.imageUrls.map(ingestOne),
  ]);
  const failures = [satellite, route, ...gallery].filter(
    (image): image is Extract<OneResult, { ok: false }> => !image.ok,
  );
  if (failures.length > 0) {
    const reason = failures.some((failure) => failure.reason === "not_configured")
      ? "not_configured"
      : "rejected";
    return { ok: false, reason };
  }
  return {
    ok: true,
    satelliteImageUrl: satellite.ok ? satellite.url : undefined,
    routeImageUrl: route.ok ? route.url : undefined,
    imageUrls: gallery
      .map((image) => (image.ok ? image.url : undefined))
      .filter((url): url is string => Boolean(url)),
  };
}
