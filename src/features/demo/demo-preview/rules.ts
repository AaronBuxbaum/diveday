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
};

/**
 * What the founder may dress a preview in. A colour that is not a colour is
 * refused rather than dropped, so a typo is seen before the email goes out.
 */
export function parsePreviewInput(
  raw: unknown,
): { ok: true; input: PreviewInput } | { ok: false; error: "invalid" | "invalid_color" } {
  const parsed = previewInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;
  let brandColor: string | null = null;
  if (data.brandColor) {
    const color = parseBrandColor(data.brandColor);
    if (!color.valid || !color.value) return { ok: false, error: "invalid_color" };
    brandColor = color.value;
  }
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
