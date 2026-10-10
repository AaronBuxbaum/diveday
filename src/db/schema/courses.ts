import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import type { CourseTemplateSnapshot } from "@/lib/course-template-sync";
import type {
  CourseFaq,
  CourseGalleryPhoto,
  CourseLearningMaterial,
  CourseScheduleDay,
} from "@/lib/courses";
import { certificationLevel, people, shops } from "./core";

/**
 * Courses and the inquiries (date requests) divers send about them.
 */

/**
 * Course definitions are the reusable instruction catalog. A course session
 * remains a trip so enrollment, capacity, crew, waivers, and manifests
 * all share one operational spine.
 */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * **`COLLATE "und-x-icu"` in the database**, set by
     * `drizzle/20261010081009_site-gear-course-collation` — the same treatment
     * `people.full_name` has (see its comment in `core.ts`). The type here is
     * plain `text` because drizzle-orm's pg-core has no way to say it, and a
     * later `pnpm db:generate` will not take it back off.
     *
     * On the column so that every `orderBy` over it inherits it with no query
     * edit: the course roster and the public course list puts "Ángel" beside "Ana"
     * rather than after "Zoe", on PGlite and on a real server alike.
     * Deterministic, so the per-shop unique index stays byte equality.
     * `src/db/name-collation.test.ts` proves it.
     */
    title: text("title").notNull(),
    agency: text("agency").notNull().default("padi"),
    /** Short internal blurb shown in staff lists and pickers; not the marketing copy. */
    description: text("description"),
    /**
     * Provenance for the code-owned DiveDay template this course started from.
     * These are nullable because courses created before template syncing, or
     * made entirely by a shop, have no safe baseline for a three-way merge.
     */
    sourceTemplateSlug: text("source_template_slug"),
    sourceTemplateVersion: integer("source_template_version"),
    sourceTemplateSnapshot: jsonb("source_template_snapshot").$type<CourseTemplateSnapshot>(),
    /**
     * URL segment for the public course page. Shop-scoped rather than global so
     * two shops can both publish /courses/open-water-diver.
     */
    slug: text("slug").notNull(),
    /**
     * The diver-facing page. These fields only ever render — the operational
     * course facts (prices, cert gate, isActive) stay above. Shapes and parsers
     * live in src/lib/courses.ts.
     */
    summary: text("summary"),
    overview: text("overview"),
    heroImageUrl: text("hero_image_url"),
    /** Real alt text, staff-authored; falls back to "{title} — photo N" when blank (H-accessibility). */
    heroImageAlt: text("hero_image_alt"),
    /**
     * The gallery: one object per photo, each carrying its own caption.
     *
     * Replaces the `image_urls` / `image_alts` pair, which were two jsonb
     * arrays lined up by position with nothing enforcing that they stayed the
     * same length — so one drifted row captioned every photo after it with the
     * previous photo's words, silently and only for the readers alt text is for
     * (DATA-L4, review 20260802). One object per photo makes the pairing
     * structural.
     *
     * The `20260806051740_course-gallery-photos` migration backfilled by
     * zipping the two old arrays on index, and it had to choose what to do with
     * a row where they had already drifted: **a url with no matching alt keeps
     * the photo and takes an empty caption; an alt with no matching url is
     * dropped.** A photo is the thing a diver sees, so losing one would visibly
     * change a published page; a caption with no photo has nothing to caption,
     * and keeping it would only re-create the misalignment under a new name.
     * The empty caption it lands on is the same "no caption yet" the editor
     * already writes, and it falls back to the generated "{title} — photo {n}"
     * exactly as a blank always has. Asserted against the shipped SQL in
     * `courses-gallery-backfill.test.ts`.
     *
     * The two old columns are gone: `20260806105408_drop-course-legacy-gallery`
     * dropped them, and nothing has written them since. That migration is the
     * contract half of the expand/contract split
     * (docs/engineering/deploy-and-migrations-runbook.md) and carries the
     * acknowledgement marker `pnpm check:migrations` requires, including what
     * the single-deploy shape of it cost — read it before assuming a drop here
     * is routine.
     */
    galleryPhotos: jsonb("gallery_photos").$type<CourseGalleryPhoto[]>().notNull().default([]),
    durationText: text("duration_text"),
    groupSizeText: text("group_size_text"),
    minimumAge: integer("minimum_age"),
    /** Prose beside the `minimum_certification_level` gate, never a substitute for it. */
    prerequisiteNote: text("prerequisite_note"),
    includes: jsonb("includes").$type<string[]>().notNull().default([]),
    excludes: jsonb("excludes").$type<string[]>().notNull().default([]),
    scheduleDays: jsonb("schedule_days").$type<CourseScheduleDay[]>().notNull().default([]),
    faqs: jsonb("faqs").$type<CourseFaq[]>().notNull().default([]),
    /**
     * **What a student works through before the first day** — name, optional
     * `https:` link, optional one-line note — in the shop's own words, edited
     * on the course page and delivered by the booking confirmation, the
     * week-out reminder and `/ready` (ADR 20261008-course-learning-materials).
     *
     * Shop content, not template content: a template seeds it when the course
     * is made and no template update ever rewrites it, because the links are
     * usually the shop's own (an affiliate link into the agency's store). That
     * is why it is absent from `COURSE_TEMPLATE_SYNC_FIELDS`. Written through
     * `sanitizeLearningMaterials`, read through `readLearningMaterials`
     * (src/lib/courses.ts), so a non-https link never reaches a diver.
     */
    learningMaterials: jsonb("learning_materials")
      .$type<CourseLearningMaterial[]>()
      .notNull()
      .default([]),
    /**
     * Two additive amounts, not a price and a bundle total: an enrollment
     * invoices as `price_cents` + `e_learning_price_cents` on one bill, so
     * either line can be cleared or refunded on its own (a student who already
     * did the e-learning). See src/lib/courses.ts.
     */
    priceCents: integer("price_cents"),
    eLearningPriceCents: integer("e_learning_price_cents"),
    /** Optional private course price when a session is run as a private group. */
    privatePriceCents: integer("private_price_cents"),
    /**
     * Set by the certifying agency, not the shop: null means an uncertified
     * participant may enroll (for example, DSD/OW). Staff read it; nothing in
     * the app offers to edit it.
     */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    /**
     * **The rung this course leaves its students on**, or null for a course
     * that issues none — a specialty, a refresher, a taster, or a course the
     * shop built without a template (issue #2059). Agency fact like the gate
     * above it: copied from the template when the course is made, carried by
     * a template update (`COURSE_TEMPLATE_SYNC_FIELDS`), and offered to no
     * editor. It replaced a lookup by `source_template_slug`, which kept
     * answering for the original template however the shop rewrote its copy.
     *
     * Read by `listCourseSeatsInTraining` (a booked student counts as in
     * training for this level) and by the roster's "Certify diver" select,
     * which opens on it.
     */
    certifiesLevel: certificationLevel("certifies_level"),
    /**
     * The one visibility switch: hides the course from the session picker and
     * takes its public page down. There is no separate draft/publish state —
     * a course is either offered, or it is hidden.
     */
    isActive: boolean("is_active").notNull().default(true),
    /**
     * A no-certification-required taster session (Discover Scuba Diving, Try
     * Scuba, …). DiveDay's own published catalog says which entries these are
     * (`COURSE_TEMPLATES` in src/content/course-templates.ts) — never sniffed from
     * the title at render time, which would pattern-match English words and
     * silently miss a differently-worded or translated one, and no longer
     * editable on the course page either: it selects the tighter 2:1 in-water
     * ratio (src/lib/course-ratios.ts), which is not a claim a shop makes
     * about itself while editing marketing copy.
     */
    isIntroCourse: boolean("is_intro_course").notNull().default(false),
    /**
     * Whether a diver may request an enriched-air fill on a session of this
     * course — the shop's answer to "can we run this one on nitrox?", set per
     * course because it is a property of the course rather than of the boat.
     *
     * Two gates, both of which must pass before the nitrox box appears on a
     * booking: the shop has to fill nitrox at all (`shopOffersNitrox`, from
     * `shops.rental_items`) and the course has to permit it — see
     * `nitroxAvailableOn` in src/lib/rentals.ts, which is the one place the
     * two are composed. A trip with no course is unaffected.
     *
     * Defaults true, so every ordinary continuing-education course keeps
     * behaving exactly as it did before this column existed. The migration
     * backfills **false** for the two shapes where the box could only ever
     * mislead: a taster, and any course open to uncertified divers. Nobody on
     * those holds a nitrox card — the fill gate needs a verified one
     * (`authorizesNitroxFill`, src/db/nitrox.ts) — and their training dives are
     * conducted on air, so offering the tick box would advertise something the
     * course cannot deliver.
     */
    nitroxCompatible: boolean("nitrox_compatible").notNull().default(true),
    /**
     * **The row's edit generation, for the "somebody else changed this" refusal.**
     *
     * Both editors post their *whole* form — nine sections, pricing, photos,
     * the day-by-day plan — so a second writer does not overwrite one field,
     * they revert every section to whatever it held when their tab opened. Two
     * tabs, no warning, and the first writer's work gone with no record that it
     * existed (issue #820).
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_shop_title_unique").on(table.shopId, table.title),
    uniqueIndex("courses_shop_slug_unique").on(table.shopId, table.slug),
    index("courses_shop_active_idx").on(table.shopId, table.isActive),
    // Backs the command-palette's courses arm (src/db/search.ts) — a leading
    // wildcard `ilike '%query%'`, which the (shop_id, title) unique btree above
    // cannot serve however tempting it looks: that index answers equality and
    // prefixes, never an interior substring (DATA-L6).
    index("courses_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
  ],
);

/*
 * `course_paths` / `course_path_steps` were dropped here — the shop-built
 * certification progression is gone, catalog order carries what it said
 * (ADR 20260805-remove-certification-paths).
 */

/**
 * The one question that changes what the shop replies with — enrollment,
 * referral to an earlier course, or a card the desk reviews first. Mirrors
 * `CourseInquiryExperience` in src/lib/course-inquiry.ts exactly; keep both
 * in sync on change.
 */
export const courseInquiryExperience = pgEnum("course_inquiry_experience", [
  "never",
  "tried",
  "certified",
  "lapsed",
]);

/**
 * A diver asking a shop to run something on a date that is not on the board.
 *
 * Written from two places now, and the table is deliberately one:
 * `/s/<shop>/courses/<slug>`, where the request names a course, and `/s/<shop>`
 * itself, where it names nothing and says what it is about in `interest`
 * instead ("a two-tank on the wrecks"). From a shop's point of view the rows
 * are the same thing — a person, a way to reach them, what they can already do,
 * and what they want — and one table means one erasure path (src/db/
 * anonymize.ts), one export column set (src/db/export.ts), and one staff list
 * (/shop/<shop>/requests). Splitting them would duplicate all three to express
 * a difference that is a single nullable foreign key.
 *
 * Deliberately small still: name, email, and phone are each optional (a diver
 * may leave only one way to reach them), and there is no status/response
 * tracking — follow-up happens in the shop's own inbox and on the requests
 * list, not as a workflow here.
 */
export const courseInquiries = pgTable(
  "course_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The course this is about, or null when the request is for an ordinary
     * dive rather than a course — the schedule page's form has no course to
     * name, and says what it wants in `interest` instead. The check constraint
     * below is what keeps "null" from meaning "about nothing".
     */
    courseId: uuid("course_id").references(() => courses.id),
    /**
     * What an ordinary dive request is about, in the diver's own words — "a
     * two-tank on the wrecks", "a night dive". Only a *course* request can
     * leave this null, because the course is what it is about.
     */
    interest: text("interest"),
    /**
     * The date the diver would like, and the one they could also make.
     *
     * A `preferred_date` column existed once and was dropped on 2026-08-12:
     * "the date picker beside 'When suits you' implied a precision the answer
     * never had — a diver's date is a request the shop replies to, never a
     * hold". That was true of a lone picker whose output nobody at the shop
     * could read on screen. A date stops being false precision once something
     * groups by it: "four people could make the 12th" is a departure waiting to
     * be scheduled, which is what /shop/<shop>/requests renders. The dates came
     * back *with* that surface, and `alternate_date` is what keeps the first one
     * honest — a diver with one workable date and one fallback is stating a
     * range, not booking a slot.
     *
     * Calendar dates, with no instant in them: stored as `date`, rendered with
     * an explicit UTC zone (src/lib/calendar-date.ts).
     */
    preferredDate: date("preferred_date", { mode: "string" }),
    alternateDate: date("alternate_date", { mode: "string" }),
    /** "Any of these, or near them" — see `groupDateRequests` in src/lib/date-requests.ts. */
    dateFlexible: boolean("date_flexible").notNull().default(false),
    /**
     * The shop's diver this lead belongs to, when that was knowable *at capture
     * time* — resolved by `recordCourseInquiry` from an exact, case-insensitive
     * match of the supplied email against a live person of this shop
     * (`people_shop_email_unique` makes that at most one row, so the link is
     * deterministic, never a guess). Null whenever the writer left no email, or
     * left one no diver of this shop holds — a lead genuinely is written before
     * any person exists, which is why the column is nullable and why nothing
     * downstream may treat null as "nobody".
     *
     * It exists for erasure (ADR 20260802-diver-data-erasure): the sweep's only
     * other handles are the email and phone still sitting on this row, so a
     * diver who later changes their address takes their own lead out of reach.
     * Snapshotting the link at the moment the two addresses did agree is what
     * survives that. Never back-filled by a matching job: a link written later
     * from fuzzier evidence would erase a bystander's lead.
     */
    personId: uuid("person_id").references(() => people.id),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    /** Optional context from the diver; a date request does not require it. */
    experienceLevel: courseInquiryExperience("experience_level"),
    /**
     * Free prose — "the week of 12 August", "any weekend in the autumn". Kept
     * exactly as it was when the date columns arrived: the dates do not replace
     * it, and this is still the one field that can hold what a diver means when
     * no date can say it.
     */
    timing: text("timing"),
    /** How many people, including the writer; null when left blank. */
    divers: integer("divers"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The notification/moderation read: this shop's inquiries, newest first.
    index("course_inquiries_shop_created_idx").on(table.shopId, table.createdAt),
    // "Who's asking about this course" for a course-scoped view.
    index("course_inquiries_course_idx").on(table.courseId),
    // The requests list reads by requested date, dateless rows last.
    index("course_inquiries_shop_preferred_date_idx").on(table.shopId, table.preferredDate),
    // A request must be about *something*. The server action refuses this in
    // words before an insert is attempted (src/app/actions/inquiry.ts); this is
    // the backstop that keeps a row nobody can act on out of the table.
    check(
      "course_inquiries_subject_present",
      sql`${table.courseId} is not null or length(btrim(coalesce(${table.interest}, ''))) > 0`,
    ),
  ],
);

export type Course = typeof courses.$inferSelect;
