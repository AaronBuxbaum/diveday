import { z } from "zod";
import { type DepthUnit, depthToMeters, MAX_ENTERED_DEPTH_METERS } from "./depth-units";
import { hasRoute, parseRoutePoints, parseRouteZoom, type RoutePoint } from "./dive-site-route";

const MAX_SITE_IMAGES = 6;

/** Turn staff's one-link-per-line form input into a compact, safe site gallery. */
export function splitMediaUrls(value: string): string[] {
  const urls = [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  if (urls.length > MAX_SITE_IMAGES) throw new Error("Choose up to six images.");
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Each image must be a complete HTTP(S) link.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Each image must be a complete HTTP(S) link.");
    }
  }
  return urls;
}

/**
 * Why a submitted site briefing was refused. A code, never a sentence: both the
 * create and the edit form map it to a staff message key, and every rule that
 * can reject a submission has its own code so the banner can name *that* rule
 * instead of blaming the fields it happens to mention.
 *
 * `coordinatesIncomplete` exists because it is the likeliest rejection on this
 * form — twenty optional fields, and the one pairing rule between two of them —
 * and it used to arrive as a generic "check the required name and links", which
 * names neither coordinate.
 */
export type DiveSiteFormError =
  | "invalid"
  | "coordinatesIncomplete"
  | "depthTooDeep"
  | "images"
  | "imagesUnconfigured";

/**
 * Everything a staffer had typed when a submission was refused, keyed by field
 * name — one entry per value, so a checkbox group (`specialty`) survives too.
 *
 * It has to travel back with the refusal because React empties an uncontrolled
 * form once its action settles; the form re-renders from the server with blank
 * defaults, and without this the briefing the staffer typed is simply gone.
 */
export type SubmittedFormValues = Record<string, string[]>;

/** Snapshot a rejected submission so the form can be handed back as it was typed. */
export function submittedValues(formData: FormData): SubmittedFormValues {
  const values: SubmittedFormValues = {};
  for (const [name, value] of formData.entries()) {
    // React posts its own bookkeeping fields alongside the real ones; they
    // match no control on the page and have no business coming back.
    if (typeof value !== "string" || name.startsWith("$ACTION")) continue;
    const entered = values[name] ?? [];
    entered.push(value);
    values[name] = entered;
  }
  return values;
}

const optionalUrl = z.union([z.literal(""), z.url().max(2_000)]);

/**
 * The shape both site forms post. No Zod `message` arguments anywhere: a
 * message argument is an English sentence that `pnpm check:copy` cannot see
 * (it only scans JSX), so it sits latent until the first surface renders an
 * issue and leaks untranslated. Failures come back as `DiveSiteFormError`.
 */
export const diveSiteFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_200),
  locationName: z.string().trim().max(160),
  forecastLatitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]),
  forecastLongitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]),
  satelliteImageUrl: optionalUrl,
  routeImageUrl: optionalUrl,
  imageUrls: z.string().max(12_000),
  marineLife: z.string().trim().max(400),
  marineLifeDescription: z.string().trim().max(1_200),
  difficulty: z.string().trim().max(120),
  depthRange: z.string().trim().max(120),
  // Typed in the shop's own unit (metres or feet), so the real bound can only
  // be applied once the unit is known — this is the loose outer guard, and
  // `parseDiveSiteForm`'s `depthUnit` argument applies the true ceiling.
  maxDepth: z.union([z.literal(""), z.coerce.number().positive().max(1_000)]),
  currentNote: z.string().trim().max(500),
  divePlan: z.string().trim().max(1_200),
  landmarks: z.string().max(4_000),
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).nullable(),
  ),
  // The route arrives as one JSON string from the editor's hidden input, and
  // both it and the zoom are normalised by `src/lib/dive-site-route.ts` rather
  // than described here: they are geometry with clamping and a cap, not a
  // shape Zod can express without repeating those rules in a second place.
  // Absent (an older form, a hand-rolled post) reads as "no route", which is
  // what most sites have.
  routePoints: z.string().max(4_000).optional(),
  routeZoom: z.string().max(4).optional(),
  routeLabel: z.string().trim().max(80).optional(),
  routeNote: z.string().trim().max(240).optional(),
});

export type DiveSiteFormFields = z.output<typeof diveSiteFormSchema>;

/** The normalised route half of a parsed submission. */
export type DiveSiteFormRoute = {
  points: RoutePoint[];
  zoom: number;
  label: string;
  note: string;
};

export type DiveSiteFormParse =
  | {
      ok: true;
      fields: DiveSiteFormFields;
      maxDepthMeters: number | null;
      route: DiveSiteFormRoute;
    }
  | { ok: false; error: DiveSiteFormError };

/**
 * Validate one posted site briefing.
 *
 * `depthUnit` is the shop's own setting, read from the shop row by the caller
 * and never from a form field — a hidden input would let a crafted post store a
 * depth 3.3× off.
 */
export function parseDiveSiteForm(
  entries: Record<string, unknown>,
  depthUnit: DepthUnit,
): DiveSiteFormParse {
  const parsed = diveSiteFormSchema.safeParse(entries);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { forecastLatitude, forecastLongitude, maxDepth } = parsed.data;
  // Both or neither: a forecast needs a point, and half a point is a silent
  // no-forecast rather than the site the staffer thought they had saved.
  if ((forecastLatitude === "") !== (forecastLongitude === "")) {
    return { ok: false, error: "coordinatesIncomplete" };
  }
  const maxDepthMeters = maxDepth === "" ? null : depthToMeters(maxDepth, depthUnit);
  if (maxDepthMeters !== null && maxDepthMeters > MAX_ENTERED_DEPTH_METERS) {
    return { ok: false, error: "depthTooDeep" };
  }
  // A route drawn against coordinates the site no longer has is a line over
  // nothing — the briefing needs the frame to place it in. Dropping the points
  // rather than refusing the save: the staffer's edit (clearing the
  // coordinates) is the deliberate act, and it is the route that has stopped
  // meaning anything, not the submission.
  const hasCoordinates = forecastLatitude !== "" && forecastLongitude !== "";
  const routePoints = hasCoordinates ? parseRoutePoints(parsed.data.routePoints) : [];
  return {
    ok: true,
    fields: parsed.data,
    maxDepthMeters,
    route: {
      points: routePoints,
      zoom: parseRouteZoom(parsed.data.routeZoom),
      // A label or note with no route to caption is nothing to keep.
      label: hasRoute(routePoints) ? (parsed.data.routeLabel ?? "") : "",
      note: hasRoute(routePoints) ? (parsed.data.routeNote ?? "") : "",
    },
  };
}
