import { z } from "zod";
import type { MarineLifeSlug } from "@/db/marine-life-catalog";
import { type DepthUnit, depthToMeters, MAX_ENTERED_DEPTH_METERS } from "./depth-units";
import { type DiveSiteDifficulty, parseDiveSiteDifficulty } from "./dive-site-difficulty";
import { parseFieldGuideSelection } from "./dive-site-field-guide";
import { type DiveSiteLandmark, parseDiveSiteLandmarks } from "./dive-site-landmarks";
import { hasRoute, parseRoutePoints, parseRouteZoom, type RoutePoint } from "./dive-site-route";
import { DOCK_DAY_LIMITS } from "./diver-planning";
import { REQUIRABLE_CERTIFICATION_LEVELS } from "./readiness";

/**
 * How many photos one site's gallery may hold in total — uploaded ones now,
 * where it used to be pasted links (there is no paste-a-URL path any more; see
 * `SiteFields`). A briefing is a page a diver reads before a dive, not an
 * album.
 */
export const MAX_SITE_IMAGES = 6;

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
 *
 * `nameTaken` is the one code raised by the database rather than by the parse:
 * `dive_sites_shop_name_unique` is a hard (shop_id, name) index, and until it
 * had a code the clash surfaced as an unhandled 23505 — a 500 error page with
 * the whole briefing gone (a real production save of "Christ of the Abyss" on
 * 2026-08-14). The index does not exclude archived sites, so the name may be
 * held by a row the staffer cannot see in their library; the message says so.
 */
export type DiveSiteFormError =
  | "invalid"
  | "coordinatesIncomplete"
  | "depthTooDeep"
  | "images"
  | "imagesUnconfigured"
  | "nameTaken"
  | "conflict";

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
  marineLife: z.string().trim().max(400),
  marineLifeDescription: z.string().trim().max(1_200),
  difficulty: z.string().trim().max(120),
  depthRange: z.string().trim().max(120),
  // Typed in the shop's own unit (metres or feet), so the real bound can only
  // be applied once the unit is known — this is the loose outer guard, and
  // `parseDiveSiteForm`'s `depthUnit` argument applies the true ceiling.
  maxDepth: z.union([z.literal(""), z.coerce.number().positive().max(1_000)]),
  // Minutes, in nobody's unit but its own — blank means the shop's own figure
  // stands, which is what almost every site says. Bounded by the same limits
  // the shop's field uses, so a site cannot name a day the Settings form would
  // have refused.
  expectedBottomTime: z.union([
    z.literal(""),
    z.coerce
      .number()
      .int()
      .min(DOCK_DAY_LIMITS.bottomTimeMinutes.min)
      .max(DOCK_DAY_LIMITS.bottomTimeMinutes.max),
  ]),
  currentNote: z.string().trim().max(500),
  divePlan: z.string().trim().max(1_200),
  /** Optional shop-stated conservation note; never a DiveDay verification. */
  conservationNote: z.string().trim().max(600).optional().default(""),
  /**
   * Which fit reading the briefing shows, or `""` for "work it out from the
   * facts" — the default, and what every site said before the shop could
   * choose (`siteFit`, ./diver-planning.ts).
   */
  fitTone: z.preprocess(
    // Absent as well as blank: an older form, or a hand-rolled post, is saying
    // "work it out", not submitting something unusable.
    (value) => (value === "" || value === undefined ? null : value),
    z.enum(["welcoming", "demanding", "unknown"]).nullable(),
  ),
  fitNote: z.string().trim().max(400).optional().default(""),
  fieldGuideTipsHeading: z.string().trim().max(80).optional().default(""),
  /**
   * Landmarks and field-guide species arrive as one JSON string each, from
   * their editors' hidden inputs — the same shape the route uses, and
   * normalised by their own modules rather than described here: both are lists
   * with per-entry caps and a length cap, which Zod could only express by
   * repeating those rules in a second place. Absent (an older form, a
   * hand-rolled post) reads as an empty list, which is what most sites have.
   */
  landmarks: z.string().max(8_000).optional(),
  creatures: z.string().max(8_000).optional(),
  // Recreational rungs only — a site may not demand a working rating of a
  // paying diver (issue #630). Read off the domain layer's own list rather than
  // respelled, so the picker and the parse cannot disagree.
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(REQUIRABLE_CERTIFICATION_LEVELS).nullable(),
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
      /** The typed override in minutes, or null when the shop's own figure stands. */
      expectedBottomTimeMinutes: number | null;
      /** The chosen difficulty code, or null — see `./dive-site-difficulty.ts`. */
      difficultyLevel: DiveSiteDifficulty | null;
      route: DiveSiteFormRoute;
      landmarks: DiveSiteLandmark[];
      creatures: MarineLifeSlug[];
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
  // A site may be saved before its GPS location is known, but a partial pair
  // is never meaningful and is refused until both coordinates are present.
  if (
    (forecastLatitude === "" && forecastLongitude !== "") ||
    (forecastLatitude !== "" && forecastLongitude === "")
  ) {
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
  const routePoints = parseRoutePoints(parsed.data.routePoints);
  return {
    ok: true,
    fields: parsed.data,
    maxDepthMeters,
    expectedBottomTimeMinutes:
      parsed.data.expectedBottomTime === "" ? null : parsed.data.expectedBottomTime,
    difficultyLevel: parseDiveSiteDifficulty(parsed.data.difficulty),
    landmarks: parseDiveSiteLandmarks(parsed.data.landmarks),
    creatures: parseFieldGuideSelection(parsed.data.creatures),
    route: {
      points: routePoints,
      zoom: parseRouteZoom(parsed.data.routeZoom),
      // A label or note with no route to caption is nothing to keep.
      label: hasRoute(routePoints) ? (parsed.data.routeLabel ?? "") : "",
      note: hasRoute(routePoints) ? (parsed.data.routeNote ?? "") : "",
    },
  };
}
