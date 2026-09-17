import { MAX_ENTERED_DEPTH_METERS } from "./depth-units";
import { DIVE_SITE_DIFFICULTIES, type DiveSiteDifficulty } from "./dive-site-difficulty";
import { type DiveSiteLandmark, parseDiveSiteLandmarks } from "./dive-site-landmarks";
import { parseRoutePoints, parseRouteZoom, type RoutePoint } from "./dive-site-route";
import { MAX_SITE_IMAGES } from "./dive-sites";
import { DOCK_DAY_LIMITS } from "./diver-planning";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  parseCsv,
} from "./import";
import { isManagedStorageUrl } from "./storage/blob-host";
import { TIDE_PREFERENCES, type TidePreference } from "./tides";

/**
 * **Reading a `dive_sites.csv` back** — the half of the export bundle that did
 * not exist while three comments in and around it described a round trip
 * (issue #1771).
 *
 * This is not the shape the contacts and gear importers have, and the
 * difference is the whole design. Those read a *competitor's* file: an unknown
 * header is guessed at through an alias table, because the alternative is a
 * shop hand-editing a spreadsheet before it can leave its old system. This
 * reads **DiveDay's own** export, so there is nothing to guess and guessing
 * would be the failure mode: a column this parser does not recognise is either
 * one a later DiveDay wrote and this one would silently drop, or one the shop
 * added by hand and this one would silently ignore. Both are a restore that
 * quietly loses a fact, which the issue's own reasoning calls worse than no
 * importer at all. So an unrecognised column refuses the **file**.
 *
 * A *missing* recognised column is fine and says nothing: a shop that deleted
 * the `conservation_note` column from its copy meant to leave those notes
 * behind. Only `name` is required, because it is the one column a site cannot
 * be restored without and the key a row matches on when its id is gone.
 */
export type PreparedDiveSiteImportRow = {
  /** 1-based, counting the header, so it names the line a spreadsheet shows. */
  rowNumber: number;
  /**
   * The id the export carried. Used to match a row against this shop's own
   * library and **never written**: a supplied primary key is a shop choosing a
   * uuid, and a restore into a different shop would carry the old one across a
   * tenant boundary for no gain.
   */
  sourceId: string | null;
  name: string;
  description: string | null;
  locationName: string | null;
  difficultyLevel: DiveSiteDifficulty | null;
  depthRange: string | null;
  maxDepthMeters: number | null;
  expectedBottomTimeMinutes: number | null;
  currentNote: string | null;
  divePlan: string | null;
  conservationNote: string | null;
  fitTone: string | null;
  fitNote: string | null;
  fieldGuideTipsHeading: string | null;
  marineLife: string | null;
  marineLifeDescription: string | null;
  landmarks: DiveSiteLandmark[] | string[] | null;
  minimumCertificationLevel: string | null;
  requiredSpecialties: string[] | null;
  requiresNitrox: boolean | null;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  tideStationId: string | null;
  /**
   * What the file *claims*. Never what lands: the acknowledgement answers one
   * pairing, so `confirmedStationWrite` (src/db/dive-sites.ts) grants it only
   * where the stored row already holds this station id — which for a fresh
   * site is never (issue #1731).
   */
  tideStationConfirmed: boolean;
  tidePreference: TidePreference | null;
  satelliteImageUrl: string | null;
  routeImageUrl: string | null;
  routePoints: RoutePoint[] | null;
  routeLabel: string | null;
  routeNote: string | null;
  routeZoom: number | null;
  imageUrls: string[] | null;
  planningNote: string | null;
  deletedAt: string | null;
  /** Why this row will be skipped, or empty if it will not be. */
  issues: string[];
};

export type PreparedDiveSiteImport = {
  rows: PreparedDiveSiteImportRow[];
  /**
   * Header columns this parser does not know. Non-empty means `fatal` is
   * `unknown_columns`; they are carried so the refusal can name them, because
   * "your file has a column I don't recognise" is not actionable without it.
   */
  unknownColumns: string[];
  fatal:
    | "file_empty"
    | "no_name_column"
    | "unknown_columns"
    | "file_too_large"
    | "too_many_rows"
    | "too_many_columns"
    | "cell_too_long"
    | null;
};

/**
 * Every column `dive_sites.csv` writes, and nothing else.
 *
 * Deliberately a literal list rather than a derivation from the export's own
 * header array: the two live in different modules and a restore that silently
 * tracked a writer it could not actually read back is the failure this list
 * exists to make loud. `dive-site-import.test.ts` asserts the two agree, so
 * adding a column to the export without teaching this file about it is a red
 * test rather than a quiet drop.
 *
 * Five of them are read and not written, and the reasons differ:
 * `id` matches and is never stored; `slug` is minted from the name because two
 * shops' libraries can collide on one; `created_at` is when DiveDay first saw
 * the row rather than anything the shop owns; and `planning_note_at` /
 * `planning_note_by_person_id` are a stamp `planningNoteWrite` owns — it moves
 * the date only when the words move, which is the rule that keeps a note's
 * ninety-day window from resetting on every depth correction (issue #1204).
 */
export const DIVE_SITE_IMPORT_COLUMNS = [
  "id",
  "name",
  "location_name",
  "description",
  "difficulty_level",
  "depth_range",
  "max_depth_meters",
  "expected_bottom_time_minutes",
  "current_note",
  "dive_plan",
  "conservation_note",
  "fit_tone",
  "fit_note",
  "field_guide_tips_heading",
  "marine_life",
  "marine_life_description",
  "landmarks",
  "minimum_certification_level",
  "required_specialties",
  "requires_nitrox",
  "forecast_latitude",
  "forecast_longitude",
  "tide_station_id",
  "tide_station_confirmed",
  "tide_preference",
  "satellite_image_url",
  "route_image_url",
  "route_points",
  "route_label",
  "route_note",
  "route_zoom",
  "image_urls",
  "planning_note",
  "planning_note_at",
  "planning_note_by_person_id",
  "deleted_at",
  "created_at",
] as const;

type Column = (typeof DIVE_SITE_IMPORT_COLUMNS)[number];

/** Header matching is case- and separator-insensitive; a value never is. */
function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Postgres writes a boolean as `true`/`false`; a spreadsheet that opened the
 * file and saved it again writes `TRUE`, and a few write `1`. Anything else is
 * not a yes — a restore must never read a word it does not understand as a
 * shop having said yes to something.
 */
function flag(value: string | null): boolean {
  return value !== null && ["true", "t", "1", "yes", "y"].includes(value.toLowerCase());
}

function finiteNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * A JSON column, read back only if it parses to the shape it was written as.
 *
 * Anything else is left null and the row carries an issue rather than a guess:
 * half a drawn route is worse than none, because the waypoints are meaningless
 * without the zoom they were drawn at and a partial list renders a line the
 * shop never drew.
 */
function jsonArray(value: string | null): unknown[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * **Every shaped column goes through the normalizer that already owns it**,
 * and none of them is re-derived here (security review, issue #1771).
 *
 * `parseRoutePoints`, `parseRouteZoom` and `parseDiveSiteLandmarks` carry caps
 * and clamps a local re-implementation quietly dropped, and their own docblocks
 * name this caller: waypoints "from anywhere untrusted — a form post, a stored
 * row written by an older build, **an import**", with a cap that "is what keeps
 * a stuck finger — or a crafted POST — from storing a thousand-point blob on a
 * row every trip page loads".
 *
 * That cap is load-bearing and the row it protects is public. `DiveSiteMap`
 * reads `site.routePoints` straight off the row, from the diver's trip page,
 * and `routeFocus` does `Math.min(...xs)` — so a route of a hundred thousand
 * waypoints is a `RangeError` on an unauthenticated page, on every request,
 * for as long as the row stands. One cell of one uploaded file.
 */
function shapedRoutePoints(raw: string | null): { points: RoutePoint[] | null; kept: boolean } {
  if (raw === null) return { points: null, kept: true };
  const parsed = jsonArray(raw);
  if (parsed === null) return { points: null, kept: false };
  const points = parseRoutePoints(parsed);
  // The cap is a silent truncation in the parser, which is right for a form
  // post and wrong for a restore: a route the file drew and this stored half of
  // is a line over the wrong water. Refuse the row instead.
  return { points, kept: points.length === parsed.length };
}

function shapedLandmarks(raw: string | null): {
  landmarks: DiveSiteLandmark[] | null;
  kept: boolean;
} {
  if (raw === null) return { landmarks: null, kept: true };
  const parsed = jsonArray(raw);
  if (parsed === null) return { landmarks: null, kept: false };
  const landmarks = parseDiveSiteLandmarks(parsed);
  return { landmarks, kept: landmarks.length === parsed.length };
}

/**
 * **A photo URL the app holds is first-party, and this does not become the
 * exception.**
 *
 * `StoredPhoto`'s docblock says every photo URL the app holds is one it
 * produced and "nothing else can be written"; ADR 20260724-dive-site-media-ingestion
 * deleted the paste-a-URL form because "a public dive-site page must never make
 * a live request to a staff-chosen third-party host — which would let that host
 * watch every visitor's IP and referrer". A CSV column is a paste-a-URL form
 * with extra steps, so anything that is not ours is dropped.
 *
 * A root-relative path is kept because that is what a local dev and e2e
 * deployment stores; `//host/x` is not root-relative, it is protocol-relative,
 * and it is exactly the shape this refuses.
 */
function managedImageUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return isManagedStorageUrl(value) ? value : null;
}

function stringArray(raw: unknown[] | null): string[] | null {
  if (raw === null) return null;
  const strings = raw.filter((entry): entry is string => typeof entry === "string");
  return strings.length === raw.length ? strings : null;
}

/** The export joins them with `"; "`; blanks collapse rather than becoming empty codes. */
function specialties(value: string | null): string[] | null {
  if (value === null) return null;
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function prepareDiveSiteImport(csv: string): PreparedDiveSiteImport {
  // **The same four caps the contacts importer enforces**, from the module this
  // one already borrows `parseCsv` from (security review, issue #1771).
  //
  // Skipping them was not a smaller file; it was an unbounded one. The server
  // action's body limit is 16 MB, and `createDiveSite` calls
  // `availableSiteSlug`, which reads *every* live site in the shop on every
  // insert — so N created rows is N queries returning up to N rows, against a
  // database every other tenant shares, inside one server action with no outer
  // transaction and no statement timeout. A file of bare `name` rows is the
  // whole attack, and the owner/manager gate does not help against a careless
  // owner or a file somebody sent them.
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES)
    return { rows: [], unknownColumns: [], fatal: "file_too_large" };
  const grid = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = grid[0];
  if (!header) return { rows: [], unknownColumns: [], fatal: "file_empty" };
  if (header.length > MAX_IMPORT_COLUMNS)
    return { rows: [], unknownColumns: [], fatal: "too_many_columns" };
  if (grid.length - 1 > MAX_IMPORT_ROWS)
    return { rows: [], unknownColumns: [], fatal: "too_many_rows" };
  // Cheaper than the per-field length caps the editor's own schema applies, and
  // it reaches every free-text column at once — a restore is not the place to
  // discover that one shop's `dive_plan` is a megabyte.
  if (grid.some((row) => row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)))
    return { rows: [], unknownColumns: [], fatal: "cell_too_long" };

  const known = new Set<string>(DIVE_SITE_IMPORT_COLUMNS);
  const indexes = new Map<Column, number>();
  const unknownColumns: string[] = [];
  header.forEach((raw, index) => {
    const name = normalizeHeader(raw);
    if (!name) return;
    if (!known.has(name)) {
      unknownColumns.push(raw.trim() || name);
      return;
    }
    // First wins on a duplicated column, the way every other reader here does.
    if (!indexes.has(name as Column)) indexes.set(name as Column, index);
  });
  if (unknownColumns.length > 0) return { rows: [], unknownColumns, fatal: "unknown_columns" };
  if (!indexes.has("name")) return { rows: [], unknownColumns, fatal: "no_name_column" };

  const read = (cells: string[], column: Column): string | null => {
    const index = indexes.get(column);
    return index === undefined ? null : text(cells[index]);
  };

  const rows = grid.slice(1).map((cells, index): PreparedDiveSiteImportRow => {
    const issues: string[] = [];
    const name = read(cells, "name");
    if (!name) issues.push("missing_name");

    const latitude = finiteNumber(read(cells, "forecast_latitude"));
    const longitude = finiteNumber(read(cells, "forecast_longitude"));
    if (latitude !== null && (latitude < -90 || latitude > 90)) issues.push("invalid_latitude");
    if (longitude !== null && (longitude < -180 || longitude > 180))
      issues.push("invalid_longitude");

    // **The bounds the editor's own schema applies**, so a restore cannot write
    // a site the form would have refused (security review, issue #1771). Both
    // drive what a diver reads on a briefing, and the depth one is
    // safety-adjacent.
    const maxDepthMeters = finiteNumber(read(cells, "max_depth_meters"));
    if (
      maxDepthMeters !== null &&
      (maxDepthMeters <= 0 || maxDepthMeters > MAX_ENTERED_DEPTH_METERS)
    )
      issues.push("invalid_max_depth");
    const bottomTimeRaw = read(cells, "expected_bottom_time_minutes");
    const expectedBottomTimeMinutes = finiteNumber(bottomTimeRaw);
    if (
      bottomTimeRaw !== null &&
      (expectedBottomTimeMinutes === null ||
        !Number.isInteger(expectedBottomTimeMinutes) ||
        expectedBottomTimeMinutes < DOCK_DAY_LIMITS.bottomTimeMinutes.min ||
        expectedBottomTimeMinutes > DOCK_DAY_LIMITS.bottomTimeMinutes.max)
    )
      issues.push("invalid_bottom_time");

    const zoomRaw = read(cells, "route_zoom");
    // `parseRouteZoom` clamps into the range the map can actually render; a
    // value outside it is a file describing a frame that does not exist, so the
    // row says so rather than being quietly moved to the nearest one.
    const routeZoom = zoomRaw === null ? null : parseRouteZoom(zoomRaw);
    if (zoomRaw !== null && routeZoom !== Number(zoomRaw)) issues.push("invalid_route_zoom");

    // **A drawn route is all four columns or none.** The waypoints are
    // positions on a frame at a zoom, so restoring them without it draws a line
    // over the wrong water — which is a briefing saying something false rather
    // than saying nothing.
    const route = shapedRoutePoints(read(cells, "route_points"));
    if (!route.kept) issues.push("invalid_route_points");
    const points = route.points;
    if (points && points.length > 0 && routeZoom === null) issues.push("route_without_zoom");

    const shaped = shapedLandmarks(read(cells, "landmarks"));
    if (!shaped.kept) issues.push("invalid_landmarks");
    const parsedLandmarks = shaped.landmarks;

    const imagesRaw = read(cells, "image_urls");
    const listed = stringArray(jsonArray(imagesRaw));
    // Every gallery entry has to be ours, and there is a limit on how many the
    // editor will hold — a restore that wrote seven would leave a site the form
    // cannot save.
    const imageUrls = listed?.map(managedImageUrl).filter((url): url is string => url !== null);
    if (imagesRaw !== null && (listed === null || imageUrls?.length !== listed.length))
      issues.push("invalid_image_urls");
    if (imageUrls && imageUrls.length > MAX_SITE_IMAGES) issues.push("too_many_images");

    const difficultyRaw = read(cells, "difficulty_level");
    const difficultyLevel = oneOf(difficultyRaw, DIVE_SITE_DIFFICULTIES);
    if (difficultyRaw !== null && difficultyLevel === null) issues.push("unknown_difficulty");

    const tideRaw = read(cells, "tide_preference");
    const tidePreference = oneOf(tideRaw, TIDE_PREFERENCES);
    if (tideRaw !== null && tidePreference === null) issues.push("unknown_tide_preference");

    // A photo URL that is not ours is dropped, and the row says so rather than
    // quietly restoring a briefing with a missing picture.
    const satelliteRaw = read(cells, "satellite_image_url");
    const routeImageRaw = read(cells, "route_image_url");
    if (satelliteRaw !== null && managedImageUrl(satelliteRaw) === null)
      issues.push("foreign_image_url");
    if (routeImageRaw !== null && managedImageUrl(routeImageRaw) === null)
      issues.push("foreign_image_url");

    const deletedAt = read(cells, "deleted_at");
    if (deletedAt !== null && Number.isNaN(Date.parse(deletedAt)))
      issues.push("invalid_deleted_at");

    return {
      rowNumber: index + 2,
      sourceId: read(cells, "id"),
      name: name ?? "",
      description: read(cells, "description"),
      locationName: read(cells, "location_name"),
      difficultyLevel,
      depthRange: read(cells, "depth_range"),
      maxDepthMeters,
      expectedBottomTimeMinutes,
      currentNote: read(cells, "current_note"),
      divePlan: read(cells, "dive_plan"),
      conservationNote: read(cells, "conservation_note"),
      fitTone: read(cells, "fit_tone"),
      fitNote: read(cells, "fit_note"),
      fieldGuideTipsHeading: read(cells, "field_guide_tips_heading"),
      marineLife: read(cells, "marine_life"),
      marineLifeDescription: read(cells, "marine_life_description"),
      landmarks: parsedLandmarks,
      minimumCertificationLevel: read(cells, "minimum_certification_level"),
      requiredSpecialties: specialties(read(cells, "required_specialties")),
      requiresNitrox:
        read(cells, "requires_nitrox") === null ? null : flag(read(cells, "requires_nitrox")),
      forecastLatitude: latitude,
      forecastLongitude: longitude,
      tideStationId: read(cells, "tide_station_id"),
      tideStationConfirmed: flag(read(cells, "tide_station_confirmed")),
      tidePreference,
      satelliteImageUrl: managedImageUrl(read(cells, "satellite_image_url")),
      routeImageUrl: managedImageUrl(read(cells, "route_image_url")),
      routePoints: points,
      routeLabel: read(cells, "route_label"),
      routeNote: read(cells, "route_note"),
      routeZoom,
      imageUrls: imageUrls ?? null,
      planningNote: read(cells, "planning_note"),
      deletedAt,
      issues,
    };
  });

  return { rows, unknownColumns, fatal: null };
}
