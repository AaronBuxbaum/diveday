import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import type { DiveSiteTemplateUndo } from "@/lib/dive-site-template-sync";
import { certificationLevel, type diveSpecialty, people, shops } from "./core";

/**
 * A shop's dive sites, the global site catalog it can copy from, field-guide
 * creatures and site moments.
 */

/**
 * Which fit reading a site's briefing shows, when the shop names one rather
 * than letting `siteFit` read it off the published facts. `unknown` is a real
 * choice, not an absence — "ask the crew" is the honest answer for a site whose
 * character depends entirely on the day.
 */
export const diveSiteFitTone = pgEnum("dive_site_fit_tone", ["welcoming", "demanding", "unknown"]);

/**
 * When a site dives best, in the shop's own reading of its water: at the
 * turn, on the rising tide, on the falling one, or `any` — the default, and
 * the honest answer for a sheltered reef. Mirrors `TIDE_PREFERENCES` in
 * `src/lib/tides.ts`; the tide window informs and gates nothing (ADR
 * 20260907-noaa-tide-predictions).
 */
export const diveSiteTidePreference = pgEnum("dive_site_tide_preference", [
  "any",
  "slack",
  "flood",
  "ebb",
]);

/**
 * How demanding a site is, as a code rather than the shop's own adjective.
 *
 * `dive_sites.difficulty` was free text, and it read as the one untranslated
 * word on an otherwise translated briefing: a Spanish page rendered
 * "EXPERIENCIA / Beginner" because the demo shop typed English into it. Every
 * value any shop or template had ever stored was already one of these three,
 * so nothing expressive is lost — and `fit_tone` right beside it was a code
 * with a translated label all along, which made the page inconsistent about the
 * same question.
 */
export const diveSiteDifficulty = pgEnum("dive_site_difficulty", [
  "beginner",
  "intermediate",
  "advanced",
]);

/**
 * A reusable, shop-owned briefing for one dive site. Trip conditions are
 * intentionally kept on the dated trip: a site library entry is evergreen,
 * while water temperature and visibility are not.
 */
export const diveSites = pgTable(
  "dive_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    sourceTemplateId: uuid("source_template_id"),
    sourceTemplateVersion: integer("source_template_version"),
    /** The last template pull's prior managed fields, for a one-time undo. */
    templateUpdateUndo: jsonb("template_update_undo").$type<DiveSiteTemplateUndo>(),
    /**
     * **`COLLATE "und-x-icu"` in the database**, set by
     * `drizzle/20261010081009_site-gear-course-collation` — the same treatment
     * `people.full_name` has (see its comment in `core.ts`). The type here is
     * plain `text` because drizzle-orm's pg-core has no way to say it, and a
     * later `pnpm db:generate` will not take it back off.
     *
     * On the column so that every `orderBy` over it inherits it with no query
     * edit: the dive-site library and every site picker puts "Ángel" beside "Ana"
     * rather than after "Zoe", on PGlite and on a real server alike.
     * Deterministic, so the per-shop unique index stays byte equality.
     * `src/db/name-collation.test.ts` proves it.
     */
    name: text("name").notNull(),
    /**
     * The site's public URL segment — `/s/<shop>/sites/molasses-reef` (N-48).
     *
     * Derived from the name once, on create, and never rewritten: correcting
     * "Molasses reef" to "Molasses Reef" must not 404 the link a diver shared
     * yesterday or the result a search engine already indexed. Same contract,
     * and the same grammar, as `trip_lenses.slug`
     * (`src/lib/dive-site-slug.ts`).
     */
    slug: text("slug").notNull(),
    description: text("description"),
    locationName: text("location_name"),
    /** Offshore coordinate selected by staff for the automated marine forecast. */
    forecastLatitude: doublePrecision("forecast_latitude"),
    forecastLongitude: doublePrecision("forecast_longitude"),
    /**
     * The NOAA CO-OPS station whose high/low table this site is read against —
     * seven digits, the nearest ocean-side station rather than the site itself,
     * which is rarely a station. Null means the briefing says nothing about the
     * tide, which is most sites (ADR 20260907-noaa-tide-predictions).
     */
    tideStationId: text("tide_station_id"),
    /**
     * **The shop saying it meant the station above, distance and all** — ADR
     * 20260907-noaa-tide-predictions' 2026-09-10 amendment, issue #1731.
     *
     * The editor prompts a second look when the station sits further than
     * `IMPLAUSIBLE_STATION_DISTANCE_KM` from the site's own coordinates
     * (`src/lib/tide-stations.ts`), and a genuinely remote site has no nearer
     * one to pick: Flower Garden Banks reads Galveston at about 190 km and is
     * correct. Without an answer that shop reads "check it's the one you
     * meant" on every visit forever, and the cost lands on the *next* warning
     * — a crew that learns to click past one learns to click past the Key
     * Largo reef reading Vaca Key, which is the mistake forty kilometres
     * exists to catch.
     *
     * `not null default false`, never nullable: "never asked" and "answered
     * no" both mean the sentence renders, and a third state would only give
     * the export a value nothing can act on.
     *
     * **It is about one pairing, not about the site.** Every writer that can
     * change `tide_station_id` clears it in the same statement
     * (`src/db/dive-sites.ts`), so a shop that acknowledges Galveston and
     * later mistypes a different id gets the prompt back. It suppresses one
     * advisory sentence on one form and is read nowhere else — not by
     * readiness, not by admission, not by any tide prediction.
     */
    tideStationConfirmed: boolean("tide_station_confirmed").notNull().default(false),
    tidePreference: diveSiteTidePreference("tide_preference").notNull().default("any"),
    satelliteImageUrl: text("satellite_image_url"),
    routeImageUrl: text("route_image_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    marineLife: text("marine_life"),
    marineLifeDescription: text("marine_life_description"),
    /** Optional shop-authored conservation note shown with this site briefing. */
    conservationNote: text("conservation_note"),
    /** How demanding the site is; the briefing prints a translated label for it. */
    difficultyLevel: diveSiteDifficulty("difficulty_level"),
    /**
     * Free-text prose for the briefing ("6–12 m", "shallow ledge to 18"). Kept
     * alongside `max_depth_meters` rather than replaced by it: it carries shape
     * and nuance a single number can't, and it is what the diver-facing site
     * card has always shown.
     */
    depthRange: text("depth_range"),
    /**
     * The site's deepest point, in metres — the one number a certification
     * ceiling can actually be compared against (H-08). Null means the shop
     * hasn't recorded one, and a null never produces a warning: this field
     * *advises*, it is not a gate, so an absent depth degrades to silence
     * rather than to a refusal.
     *
     * Always metres regardless of the shop's `depth_unit`, and floating-point
     * rather than integer for exactly that reason: a shop working in feet types
     * 60, which is 18.288 m, and must read 60 back — not the 59 an integer
     * metre would round it to.
     */
    maxDepthMeters: doublePrecision("max_depth_meters"),
    /**
     * How long a dive here actually spends in the water, in minutes — this
     * site's own answer, overriding the shop's `bottom_time_minutes` wherever
     * the dock-day rhythm is laid over a departure that visits it.
     *
     * Null is the ordinary case and means "the shop's number is right for this
     * site". It exists because the shop-wide figure is a *default*, and a wall
     * a shop runs at 30 metres and a shallow reef it runs at 60 minutes are
     * both real; a single number told a diver the wrong one on at least one of
     * them. Same bounds as the shop's own field (`DOCK_DAY_LIMITS`), enforced
     * by the CHECK below as well as the form, because a dive with no time in
     * it is not a dive.
     */
    expectedBottomTimeMinutes: integer("expected_bottom_time_minutes"),
    currentNote: text("current_note"),
    divePlan: text("dive_plan"),
    /**
     * Which fit reading the briefing shows above the facts table — "Welcoming
     * dive" or "Best with recent experience". Null means *derive it* from
     * `difficulty_level`/`depth_range`/`current_note` (`siteFit`, src/lib/diver-planning.ts),
     * which is what every site did before this column existed and is still the
     * ordinary case.
     *
     * It exists because the derivation is a regex over free text a shop wrote
     * for a different purpose: a reef whose current note mentions a "deep
     * channel" read as demanding, and a shop had no way to say otherwise. A
     * code, not a sentence — the *label* is a translated status word, the same
     * shape a readiness status has. The shop's own words go in `fit_note`.
     */
    fitTone: diveSiteFitTone("fit_tone"),
    /**
     * The shop's own sentence under that label, replacing DiveDay's canned one.
     * Null leaves the canned line standing, which is a true sentence about a
     * site nobody has written about yet.
     */
    fitNote: text("fit_note"),
    /**
     * The heading over the field guide's "slow down and you'll see more" aside
     * — the one DiveDay wrote ("See more by slowing down") unless the shop has
     * its own. The tips under it are the shop's already: they come off its own
     * `dive_site_creatures` rows.
     */
    fieldGuideTipsHeading: text("field_guide_tips_heading"),
    /**
     * Named things the crew points at, each with the shop's own note on it —
     * `{ name, kind, note }` (src/lib/dive-site-landmarks.ts). Plain strings
     * are still read (that is all this column held until landmarks carried
     * their own words, and what the CSV import posts), as a name with nothing
     * said about it.
     */
    landmarks: jsonb("landmarks").$type<DiveSiteLandmark[] | string[]>().notNull().default([]),
    /**
     * The underwater route, as waypoints a staffer clicked onto the site's
     * satellite view. Percentages of that view's box (0–100, origin top-left),
     * never latitude/longitude: the briefing draws them into an SVG overlaid
     * on the embed at exactly the same `viewBox`, so a percentage is the
     * coordinate the drawing is actually in. Empty means no route — the
     * briefing shows the plain satellite frame, which is the ordinary case.
     *
     * The frame those percentages refer to is `forecast_latitude` /
     * `forecast_longitude` at `route_zoom`, which is why the editor never lets
     * the map be panned: a route saved against a view the viewer cannot
     * reproduce is a line drawn over the wrong water. See
     * `src/lib/dive-site-route.ts`.
     */
    routePoints: jsonb("route_points").$type<{ x: number; y: number }[]>().notNull().default([]),
    /** What the route is called on the briefing ("Reef garden loop"). */
    routeLabel: text("route_label"),
    /** One line under the label, in the shop's own words. */
    routeNote: text("route_note"),
    /** Google Maps zoom the route was drawn at, and must be rendered at. */
    routeZoom: integer("route_zoom").notNull().default(16),
    /**
     * The site's inherent cert gate, composed into every trip that visits it
     * (readiness.ts takes the stricter of site and trip). Null means the site
     * imposes no level of its own — never "unknown".
     */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    /** Specialties the site itself demands; unioned with the trip's own list. */
    requiredSpecialties: jsonb("required_specialties")
      .$type<(typeof diveSpecialty.enumValues)[number][]>()
      .notNull()
      .default([]),
    /**
     * Whether the site demands a verified nitrox card to board. Evidence lives
     * in nitrox_certifications (also the mix-request gate), so this is its own
     * flag, not a member of required_specialties.
     */
    requiresNitrox: boolean("requires_nitrox").notNull().default(false),
    /** Archived briefings remain attached to historical trips but leave active pickers. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * **The row's edit generation, for the "somebody else changed this" refusal.**
     *
     * A briefing posts its *whole* form — twenty-odd fields, the landmark list,
     * the field guide, the drawn route — so a second writer does not overwrite
     * one field, they revert every section to whatever it held when their tab
     * opened. Two tabs, no warning, and the first writer's afternoon gone with
     * no record that it existed (issue #820).
     *
     * The page carries this number back as a hidden field and the save compares
     * it. A mismatch is **refused, never merged**: resolution is a merge UI and
     * this does not need one — the refusal keeps every value the writer typed.
     *
     * **A counter rather than a timestamp, and that is not a style choice.**
     * The first cut of this compared `updated_at`, falling back to `created_at`
     * for a row nobody had saved. Postgres `now()` has microsecond resolution
     * and a JS `Date` has millisecond, so the value a page reads out and posts
     * back is already truncated and `timestamptz '…12.123' = '…12.123456'` is
     * false — every save refused, forever, for a lone writer with one tab open.
     * **PGlite's `now()` returns whole milliseconds**, so dev, every unit test
     * and the whole e2e fleet round-trip it losslessly and saw nothing. An
     * integer takes the clock out of the comparison entirely; `NOT NULL
     * DEFAULT 0` takes the null out of it too.
     *
     * **Every writer that rewrites this row's prose must bump it**, not only
     * the editor — a template pull that leaves the number alone hands the same
     * silent revert back to the editor's next save. See
     * `src/db/editor-row-versions.postgres.test.ts`, which is where this is
     * held to real Postgres rather than to PGlite.
     *
     * A save carrying no version at all is allowed: the migration runs inside
     * the production build while the previous release is still serving
     * (AGENTS.md's expand/contract rule), and a page that release rendered
     * posts no hidden field. That fail-open makes this an **anti-accident
     * control, not a tamper-proof one** — a staffer who strips the field can
     * still clobber a colleague, and they were already authorised to save the
     * form.
     */
    rowVersion: integer("row_version").notNull().default(0),
    /**
     * **What the shop wants to remember about running this site** (issue
     * #1204) — the silted-up entry, the mooring ball somebody moved, the
     * ranger who wants a call first.
     *
     * Staff-only, and the one column on this row that is: every other piece of
     * prose here is written for a diver to read. It is deliberately absent
     * from `getTripDiveSitesPeek`'s projection and from every reader under
     * `src/app/s/**`, which `src/db/dive-sites.test.ts` asserts on the
     * returned keys rather than trusting a reviewer to notice.
     *
     * Stamped with who noted it and when. The stamp only moves when the words
     * change, so re-saving a briefing does not refresh a note nobody
     * re-thought, and the note leaves the *site list* after
     * `PLANNING_NOTE_FRESH_DAYS` rather than being erased — an expiry is a
     * note falling off a planning surface, not a record being destroyed.
     */
    planningNote: text("planning_note"),
    planningNoteAt: timestamp("planning_note_at", { withTimezone: true }),
    planningNoteByPersonId: uuid("planning_note_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dive_sites_shop_name_unique").on(table.shopId, table.name),
    // Over the **live** rows only, unlike the name index above it: a deleted
    // site keeps its slug so nothing rewrites history, and a shop that deletes
    // "Molasses Reef" and writes it again should get the URL back rather than
    // `molasses-reef-2` forever (ADR 20260820-every-delete-is-soft).
    uniqueIndex("dive_sites_shop_slug_key")
      .on(table.shopId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    // All three or none: a note nobody is recorded as having written, or a
    // stamp with no words under it, is a row no surface can render honestly.
    check(
      "dive_sites_planning_note_attributed",
      sql`(${table.planningNote} is null) = (${table.planningNoteAt} is null)
        and (${table.planningNoteAt} is null) = (${table.planningNoteByPersonId} is null)`,
    ),
    check(
      "dive_sites_planning_note_not_blank",
      sql`${table.planningNote} is null or length(btrim(${table.planningNote})) > 0`,
    ),
    index("dive_sites_shop_name_idx").on(table.shopId, table.name),
    // Null (the shop's own number applies) or a real duration — never zero,
    // for the same reason `shops_bottom_time_minutes_positive` exists.
    check(
      "dive_sites_expected_bottom_time_positive",
      sql`${table.expectedBottomTimeMinutes} is null or ${table.expectedBottomTimeMinutes} > 0`,
    ),
    // Backs the command-palette leading-wildcard ILIKE search (src/db/search.ts, CR-018).
    index("dive_sites_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    // The site library's own search box matches a place as well as a name
    // ("Key Largo") — `listDiveSitesPage` in src/db/dive-sites.ts ors the two,
    // and only the name half was indexed (DATA-L6).
    index("dive_sites_location_trgm_idx").using("gin", sql`${table.locationName} gin_trgm_ops`),
  ],
);

/** DiveDay-maintained common-site catalog; shops copy a published version into their own library. */
export const globalDiveSites = pgTable(
  "global_dive_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    currentVersion: integer("current_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("global_dive_sites_slug_idx").on(table.slug)],
);

/**
 * One published version of a catalog site, as a whole briefing.
 *
 * It carries everything the dive-site form can write, because a template a shop
 * cannot take whole is a template it has to finish by hand: the first version
 * of this shape held eight fields, so importing "Molasses Reef" produced a site
 * with no cert gate, no landmarks worth reading, and an empty field guide. The
 * two lists are the same shapes the form posts, and `creatureSlugs` names rows
 * of `./marine-life-catalog.ts` rather than repeating their words — the import
 * copies those words onto the shop's own rows, where the shop edits them.
 */
export type GlobalDiveSiteBriefing = {
  name: string;
  description?: string;
  locationName?: string;
  forecastLatitude?: number;
  forecastLongitude?: number;
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls?: string[];
  marineLife?: string;
  marineLifeDescription?: string;
  conservationNote?: string;
  /**
   * Legacy free text, on versions published before 2026-08-13. Published
   * snapshots are immutable, so the field stays readable forever; the import
   * narrows it through `parseDiveSiteDifficulty` like any other stored value.
   */
  difficulty?: string;
  /** How demanding the site is, as a `dive_site_difficulty` code. */
  difficultyLevel?: (typeof diveSiteDifficulty.enumValues)[number];
  depthRange?: string;
  maxDepthMeters?: number;
  expectedBottomTimeMinutes?: number;
  currentNote?: string;
  divePlan?: string;
  fitTone?: (typeof diveSiteFitTone.enumValues)[number];
  fitNote?: string;
  fieldGuideTipsHeading?: string;
  landmarks?: DiveSiteLandmark[];
  /** Catalog slugs, resolved to the shop's own field-guide rows at import. */
  creatureSlugs?: string[];
  minimumCertificationLevel?: (typeof certificationLevel.enumValues)[number];
  requiredSpecialties?: (typeof diveSpecialty.enumValues)[number][];
  requiresNitrox?: boolean;
};

/** Immutable published snapshots; a later correction never rewrites a shop's source evidence. */
export const globalDiveSiteVersions = pgTable(
  "global_dive_site_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    globalDiveSiteId: uuid("global_dive_site_id")
      .notNull()
      .references(() => globalDiveSites.id),
    version: integer("version").notNull(),
    briefing: jsonb("briefing").$type<GlobalDiveSiteBriefing>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("global_dive_site_versions_unique").on(table.globalDiveSiteId, table.version),
  ],
);

/**
 * Which species a dive site's field guide shows, and in what order — the site's
 * own selection from DiveDay's catalog, chosen on the dive-site form
 * (`src/lib/dive-site-field-guide.ts`).
 *
 * A row is a slug and a position. Every word a person reads off it comes from
 * `marineLife.*` in *their* language, resolved at render by
 * `src/i18n/marine-life-labels.ts` — so one saved briefing reads in English to
 * one diver and in Spanish to the next (ADR 20260813-marine-life-is-diveday-copy).
 */
export const diveSiteCreatures = pgTable(
  "dive_site_creatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    diveSiteId: uuid("dive_site_id")
      .notNull()
      .references(() => diveSites.id),
    /**
     * Which species this is: a `MARINE_LIFE_CATALOG` slug, and the key its
     * words are held under in every locale's bundle. Nullable in the column
     * only because rows written before the catalog became app copy could name a
     * species a shop had typed itself; a row with no slug has no words and is
     * skipped by every reader (`fieldGuideCards`). Nothing writes null now.
     */
    catalogSlug: text("catalog_slug"),
    /**
     * Where this face sits in the guide. The list had no order at all until the
     * shop could edit it — the query returned whatever the planner felt like,
     * so a briefing reshuffled its own field guide between renders and the
     * visual suite could not hold a baseline for one.
     */
    position: integer("position").notNull().default(0),
  },
  (table) => [index("dive_site_creatures_site_idx").on(table.diveSiteId)],
);

/**
 * A shop asking DiveDay for a species the catalog does not carry.
 *
 * The field guide is a selection from `MARINE_LIFE_CATALOG` and nothing else
 * (ADR 20260813-marine-life-is-diveday-copy), which is what lets every card
 * render in the reader's own language — and which means a shop diving outside
 * the tropical western Atlantic meets a picker that refuses its reef. This
 * table is the honest other half of that refusal: the picker says "tell us what
 * we are missing" and this is where it lands.
 *
 * **Nothing renders from here.** It is not content, it is a request, and no
 * diver-facing or staff-facing surface reads it — DiveDay queries the table
 * directly and the answer arrives as a release that adds the species. That is
 * the whole contract, and it is why the row is this thin.
 *
 * Append-only and un-deduplicated on purpose: two shops asking for the same
 * animal is the signal, not a conflict, and the count is how a region earns its
 * place in the catalog ahead of a guess.
 */
export const marineLifeRequests = pgTable(
  "marine_life_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Whoever was at the form; the person to ask what they meant. */
    requestedByPersonId: uuid("requested_by_person_id")
      .notNull()
      .references(() => people.id),
    /**
     * What the staffer typed into the picker, verbatim and trimmed. Free text
     * because that is the point — a common name, a Latin binomial, or a
     * description of a fish they cannot name are all useful, and any structure
     * imposed here would be a guess about which.
     */
    query: text("query").notNull(),
    /** Which site they were writing when they hit the wall, for context. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("marine_life_requests_created_idx").on(table.createdAt)],
);

/** Staff-moderated, opt-in moments from prior divers. */
export const diveSiteMoments = pgTable(
  "dive_site_moments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    diveSiteId: uuid("dive_site_id")
      .notNull()
      .references(() => diveSites.id),
    caption: text("caption").notNull(),
    imageUrl: text("image_url"),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dive_site_moments_site_published_idx").on(table.diveSiteId, table.isPublished),
  ],
);

export type DiveSiteFitTone = (typeof diveSiteFitTone.enumValues)[number];
