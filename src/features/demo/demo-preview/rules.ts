import { z } from "zod";
import { parseBrandColor } from "../../../lib/brand";
import { DAY_MS } from "../../../lib/clock";

/** How long a preview link opens its shop: a week, the demo reaper's own window. */
export const PREVIEW_TTL_MS = 7 * DAY_MS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The link's token is the row id. Anything else is not a preview, without a query. */
export function previewIdFrom(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const id = token.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** The most departure times a preview's day takes: a shop's whole day of boats. */
export const PREVIEW_MAX_DEPARTURES = 4;
/** The demo sails two hulls, so a preview can wear two boats' names. */
export const PREVIEW_MAX_BOATS = 2;

const CLOCK_TIME = /^(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s*m?\.?)?$/i;

/**
 * One time as the founder types it ("8:30 AM", "1 pm", "13:00") or the site
 * reader writes it ("08:30"), as 24-hour "HH:MM"; null when it is not a time
 * of day a boat leaves at, between 5 AM and 9 PM.
 */
export function parseDepartureTime(raw: string): string | null {
  const match = CLOCK_TIME.exec(raw.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3]?.toLowerCase();
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  } else if (!match[2] || hour > 23) return null;
  const at = hour * 60 + minute;
  if (at < 5 * 60 || at > 21 * 60) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "8:30 AM, 1:00 PM" from a flag, as sorted "HH:MM" times; null if any part is not a time. */
export function parseDepartureTimes(raw: string): string[] | null {
  const parts = raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const times = parts.map(parseDepartureTime);
  if (times.some((time) => time === null)) return null;
  return [...new Set(times as string[])].sort();
}

const line = (max: number) => z.string().trim().min(1).max(max);

const previewInputSchema = z.object({
  name: line(80),
  site: z
    .url()
    .max(300)
    .refine((value) => /^https?:\/\//i.test(value))
    .optional(),
  brandColor: z.string().trim().optional(),
  tagline: line(140).optional(),
  locality: line(80).optional(),
  region: line(40).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  departureTimes: z.array(z.string()).max(PREVIEW_MAX_DEPARTURES).optional(),
  boatNames: z.array(line(40)).max(PREVIEW_MAX_BOATS).optional(),
});

export type PreviewInput = {
  name: string;
  site: string | null;
  /** One `#rrggbb`, or null to keep the minted demo's own colour. */
  brandColor: string | null;
  tagline: string | null;
  locality: string | null;
  region: string | null;
  /** Both or neither: half a position is no position. */
  position: { latitude: number; longitude: number } | null;
  /**
   * When the prospect's boats leave, 24-hour "HH:MM" in shop time, earliest
   * first. Empty keeps the sample schedule's own times.
   */
  departureTimes: string[];
  /** Names for the demo's two boats, in order; empty keeps the sample names. */
  boatNames: string[];
};

/**
 * What the founder may dress a preview in. A colour that is not a colour is
 * refused rather than dropped, so a typo is seen before the email goes out.
 */
export function parsePreviewInput(
  raw: unknown,
):
  | { ok: true; input: PreviewInput }
  | { ok: false; error: "invalid" | "invalid_color" | "invalid_times" } {
  const parsed = previewInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;
  let brandColor: string | null = null;
  if (data.brandColor) {
    const color = parseBrandColor(data.brandColor);
    if (!color.valid || !color.value) return { ok: false, error: "invalid_color" };
    brandColor = color.value;
  }
  const departureTimes = (data.departureTimes ?? []).map(parseDepartureTime);
  if (departureTimes.some((time) => time === null)) return { ok: false, error: "invalid_times" };
  return {
    ok: true,
    input: {
      name: data.name,
      site: data.site ?? null,
      brandColor,
      tagline: data.tagline ?? null,
      locality: data.locality ?? null,
      region: data.region ?? null,
      position:
        data.latitude !== undefined && data.longitude !== undefined
          ? { latitude: data.latitude, longitude: data.longitude }
          : null,
      departureTimes: [...new Set(departureTimes as string[])].sort(),
      boatNames: [...new Set(data.boatNames ?? [])],
    },
  };
}

/** Whether a preview's link still opens its shop at `now`. */
export function previewIsOpen(preview: { expiresAt: Date }, now: Date): boolean {
  return preview.expiresAt.getTime() > now.getTime();
}

/** The path a preview's link points at. */
export function previewPath(id: string): string {
  return `/preview/${id}`;
}
