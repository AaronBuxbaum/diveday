import { z } from "zod";
import type { OrderLineItemKind } from "@/db/schema";
import type { DepthUnit } from "./depth-units";
import { cachedFormatter } from "./intl-cache";

/**
 * A course's agency, canonicalised: `" PADI "` and `"padi"` are one agency.
 *
 * `courses.agency` is free text a CSV import can carry anything into, and this
 * catalog has held both of those spellings from exactly that. The staff roster
 * groups by agency (ADR 20260827-the-shops-shelves, decision 1) and the query
 * sorts by `lower(trim(agency))` to keep those groups from interleaving across
 * a page — so a grouping keyed on the raw column would draw one agency as
 * three headings while the query believed it had ordered them into a single
 * run. This is the SQL expression's twin, kept here rather than in `src/db` so
 * a surface can canonicalise without loading the schema.
 *
 * Not a translation: an agency code is a proper noun, and the surface
 * upper-cases it rather than looking it up in a bundle.
 */
export function canonicalAgency(agency: string): string {
  return agency.trim().toLowerCase();
}

/**
 * One block of a course's day-by-day plan: a title over a list of what
 * happens in it, with real clock times when the shop runs that day on a fixed
 * schedule. `startTime`/`endTime` are 24-hour "HH:mm" clock values — nothing
 * in the app schedules against them (the dated session does that), but they
 * are real times, not prose. `timeNote` is the escape hatch for a day that
 * doesn't run on a fixed clock at all (a multi-week internship phase, "about
 * 3 hours" for a single session) — formatScheduleDayTime prefers the clock
 * time and falls back to it.
 */
export type CourseScheduleDay = {
  title: string;
  startTime?: string;
  endTime?: string;
  timeNote?: string;
  items: string[];
};

const CLOCK_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function formatClockTime(value: string, locale: string): string | null {
  if (!CLOCK_TIME_RE.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  // The stored value is a wall-clock time of day with no date attached, so a
  // fixed UTC reference date is correct here — only the locale may vary, or a
  // Spanish diver reads "2:00 PM" where their own clock says "14:00".
  const reference = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(reference);
}

/** The day's displayed hours: a real clock range, a single clock time, the free-text note, or nothing. */
export function formatScheduleDayTime(
  day: CourseScheduleDay,
  locale = "en-US",
): string | undefined {
  const start = day.startTime ? formatClockTime(day.startTime, locale) : null;
  const end = day.endTime ? formatClockTime(day.endTime, locale) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return day.timeNote?.trim() || undefined;
}

/** Caps enforced both here and by DayByDayEditor's "Add day"/"Add item" buttons, so a save can never build a schedule the server would reject. */
export const MAX_SCHEDULE_DAYS = 30;
export const MAX_SCHEDULE_DAY_ITEMS = 20;

/** Caps enforced both here and by `FaqEditor`'s "Add question" button. */
export const MAX_FAQS = 20;

const faqInputSchema = z.object({
  question: z.string().max(200).optional().default(""),
  answer: z.string().max(1200).optional().default(""),
});

const scheduleDayInputSchema = z.object({
  title: z.string().max(160).optional().default(""),
  startTime: z.string().max(5).optional().default(""),
  endTime: z.string().max(5).optional().default(""),
  timeNote: z.string().max(120).optional().default(""),
  items: z.array(z.string().max(200)).max(MAX_SCHEDULE_DAY_ITEMS).optional().default([]),
});

/**
 * Normalizes the day-by-day editor's serialized state (DayByDayEditor posts
 * one JSON-encoded array) into `CourseScheduleDay[]`. A day left completely
 * blank (added, then never filled in) is dropped rather than rejected; a day
 * with *some* content but no title fails the save outright — the title is
 * the one thing every day needs. Returns null on malformed input (not an
 * array of day-shaped objects) or a title-less day with content.
 */
export function sanitizeScheduleDays(raw: unknown): CourseScheduleDay[] | null {
  const parsedArray = z.array(scheduleDayInputSchema).max(MAX_SCHEDULE_DAYS).safeParse(raw);
  if (!parsedArray.success) return null;

  const days: CourseScheduleDay[] = [];
  for (const entry of parsedArray.data) {
    const title = entry.title.trim();
    const items = entry.items.map((item) => item.trim()).filter(Boolean);
    const startTime = CLOCK_TIME_RE.test(entry.startTime) ? entry.startTime : undefined;
    const endTime = CLOCK_TIME_RE.test(entry.endTime) ? entry.endTime : undefined;
    const timeNote = entry.timeNote.trim();

    const isBlank = !title && !startTime && !endTime && !timeNote && items.length === 0;
    if (isBlank) continue;
    if (!title) return null;

    days.push({
      title,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(timeNote ? { timeNote } : {}),
      items,
    });
  }
  return days;
}

/**
 * A published depth limit as the agencies print it: a **pair**, never a
 * conversion. Identical in intent (and in its five values) to `DepthCeiling`
 * in src/lib/depth-ceiling.ts — 18 m and 60 ft are both the standard, and
 * neither is derived from the other. `courseDepths.test.ts` asserts the two
 * tables still agree, so a page and a roster warning can never quote different
 * limits.
 */
export type CourseDepth = { meters: number; feet: number };

/**
 * How long each prose field on the course page may be, in characters.
 *
 * Here rather than inline in the editor's zod schema because DiveDay's own
 * published course templates have to fit through that same form: they are
 * *seed* content a shop then owns and edits, so a limit the templates violate
 * fires only on words the shop never wrote. That is exactly what happened —
 * `prerequisiteNote` capped at 400 while seven templates shipped longer notes
 * (Wreck Diver's is 510), so opening one of those courses and changing anything
 * at all was refused, with the cursor thrown into an untouched box.
 * `src/db/course-templates.test.ts` asserts every template fits, so the two
 * cannot drift apart again.
 */
export const COURSE_CONTENT_LIMITS = {
  summary: 200,
  overview: 6_000,
  durationText: 120,
  groupSizeText: 120,
  prerequisiteNote: 600,
  includes: 2_000,
  excludes: 2_000,
  scheduleDaysJson: 20_000,
  faqsJson: 30_000,
} as const;

/**
 * The only depths course prose may name through a placeholder.
 *
 * Closed on purpose. A placeholder is not a converter: `depthInUnit(18, "feet")`
 * is 59, a number that appears in no dive manual anywhere (the same bug
 * `DepthCeiling` was created to kill). So `{depth18}` is a *lookup* into the
 * agency table, and a depth the table does not carry is refused at save rather
 * than silently converted into something wrong.
 */
export const COURSE_DEPTHS: readonly CourseDepth[] = [
  { meters: 12, feet: 40 },
  { meters: 18, feet: 60 },
  { meters: 21, feet: 70 },
  { meters: 30, feet: 100 },
  { meters: 40, feet: 130 },
];

const COURSE_DEPTH_BY_METERS = new Map(COURSE_DEPTHS.map((depth) => [depth.meters, depth]));

/**
 * The placeholder grammar, exactly. Two forms and no options:
 *
 * - `{depth18}`  → "18 meters" / "60 feet" — a number and its unit word.
 * - `{depth18n}` → "18" / "60" — the bare number, for a range or a list
 *   ("to {depth30n}–{depth40}") where one unit word at the end is the only
 *   readable shape.
 *
 * Deliberately **not** run through `intl-messageformat`. Course prose is a
 * shop's own free text: an apostrophe, a `#`, or a stray brace typed into a
 * paragraph is an ICU syntax error, and the translators are built with
 * `onError: () => {}` (src/i18n/messages.ts), so a real MessageFormat pass over
 * shop prose would swallow the error and hand the page a degraded or empty
 * string — a whole paragraph vanishing with nothing in the log. This scanner
 * is total instead: it rewrites what it recognises and leaves every other
 * character, brace or not, exactly as the shop typed it.
 */
const DEPTH_PLACEHOLDER = /\{depth(\d{1,3})(n?)\}/g;

/**
 * Anything brace-wrapped that was *aiming* at a depth placeholder. Wider than
 * {@link DEPTH_PLACEHOLDER} on purpose — this is what save-time validation
 * refuses, so `{depth 18}`, `{Depth18}` and `{depth18 m}` are caught as typos
 * instead of shipping to divers as literal braces.
 */
const DEPTH_PLACEHOLDER_ATTEMPT = /\{[^{}]*\}/g;
const LOOKS_LIKE_DEPTH = /^\s*depth/i;
/** A `{` that never closes, and a `}` whose `{` was deleted — both directions of a half-edit. */
const UNCLOSED_ATTEMPT = /\{\s*depth\s*\d{0,3}\s*[a-z]{0,3}/i;
const UNOPENED_ATTEMPT = /depth\s*\d{1,3}\s*n?\s*\}/i;

export type CourseDepthPlaceholderIssue = {
  /** The offending text as typed, for a log line — never for interpolation into copy. */
  token: string;
  /** `malformed`: not the grammar. `unknown`: well-formed, but not a standard depth. */
  reason: "malformed" | "unknown";
};

/**
 * Every broken depth placeholder in one string a shop just typed.
 *
 * **Removing a placeholder is not an issue.** A shop that deletes `{depth18}`
 * and writes "sixty feet" has written prose, which is exactly what this content
 * is for; the sentence simply stops following `shops.depth_unit`, and that is
 * their call. Only a *broken attempt* is refused — the half-edit that would
 * otherwise render `{depth 18}` to a diver.
 */
export function courseDepthPlaceholderIssues(text: string): CourseDepthPlaceholderIssue[] {
  const issues: CourseDepthPlaceholderIssue[] = [];
  for (const match of text.matchAll(DEPTH_PLACEHOLDER_ATTEMPT)) {
    const inner = match[0].slice(1, -1);
    if (!LOOKS_LIKE_DEPTH.test(inner)) continue; // not aimed at us; leave it alone
    const strict = /^depth(\d{1,3})(n?)$/.exec(inner);
    if (!strict) {
      issues.push({ token: match[0], reason: "malformed" });
      continue;
    }
    if (!COURSE_DEPTH_BY_METERS.has(Number(strict[1]))) {
      issues.push({ token: match[0], reason: "unknown" });
    }
  }
  // Balanced groups are accounted for above; what is left is a lost brace.
  const remainder = text.replace(DEPTH_PLACEHOLDER_ATTEMPT, " ");
  const lostBrace = UNCLOSED_ATTEMPT.exec(remainder) ?? UNOPENED_ATTEMPT.exec(remainder);
  if (lostBrace) issues.push({ token: lostBrace[0].trim(), reason: "malformed" });
  return issues;
}

/** How the caller turns one standard depth into words. Kept out of src/lib: the unit word is copy. */
export type CourseDepthFormat = {
  unit: DepthUnit;
  /** The already-localized "18 meters" / "60 feet" for a value in `unit`. */
  withUnit: (value: number) => string;
};

/**
 * Course prose with its depth placeholders resolved into the shop's own unit.
 *
 * Total by construction — it cannot throw and cannot lose text. A placeholder
 * the grammar does not recognise is left **verbatim**, so the worst a broken
 * one can do is render `{depth 18}` on the page: visible, ugly, and reported by
 * the same run of `courseDepthPlaceholderIssues` that refused the save it came
 * from. That is the deliberate trade against the alternative — a format pass
 * that throws mid-render, or an ICU pass whose error is swallowed and takes the
 * paragraph with it.
 */
export function resolveCourseDepths(text: string, format: CourseDepthFormat): string {
  return text.replace(DEPTH_PLACEHOLDER, (whole, meters: string, bare: string) => {
    const depth = COURSE_DEPTH_BY_METERS.get(Number(meters));
    if (!depth) return whole;
    const value = format.unit === "feet" ? depth.feet : depth.meters;
    return bare ? String(value) : format.withUnit(value);
  });
}

function resolveOptional(text: string | null, format: CourseDepthFormat): string | null {
  return text === null ? null : resolveCourseDepths(text, format);
}

/**
 * The prose half of a course, with every depth placeholder resolved. Applied
 * once at the top of a rendering page rather than field by field in the
 * components — a field added to {@link CourseContent} that this forgets is a
 * compile error, not a sentence that quietly stops following the shop's unit.
 *
 * The staff editor deliberately does **not** call this: it edits the source,
 * and a resolved page is not the thing being written.
 */
export function resolveCourseContentDepths<
  T extends CourseContent & { description?: string | null },
>(content: T, format: CourseDepthFormat): T {
  // Generic so a caller can hand in the whole `courses` row and get the row
  // back — the alternative leaves `course.summary` (unresolved) and
  // `content.summary` (resolved) side by side at every call site, which is a
  // trap. The cast is the price of spreading over a generic; every property
  // written below is checked against `CourseContent` by the signature.
  return {
    ...content,
    // The staff-picker blurb, which JSON-LD falls back to when there is no
    // summary (src/lib/structured-data.ts) — so it can reach a diver too.
    ...(content.description === undefined
      ? {}
      : { description: resolveOptional(content.description, format) }),
    summary: resolveOptional(content.summary, format),
    overview: resolveOptional(content.overview, format),
    durationText: resolveOptional(content.durationText, format),
    groupSizeText: resolveOptional(content.groupSizeText, format),
    prerequisiteNote: resolveOptional(content.prerequisiteNote, format),
    includes: content.includes.map((item) => resolveCourseDepths(item, format)),
    excludes: content.excludes.map((item) => resolveCourseDepths(item, format)),
    scheduleDays: content.scheduleDays.map((day) => ({
      ...day,
      title: resolveCourseDepths(day.title, format),
      items: day.items.map((item) => resolveCourseDepths(item, format)),
    })),
    faqs: content.faqs.map((faq) => ({
      question: resolveCourseDepths(faq.question, format),
      answer: resolveCourseDepths(faq.answer, format),
    })),
  } as T;
}

export type CourseFaq = { question: string; answer: string };

/**
 * One gallery photo and the caption that belongs to *it*.
 *
 * Deliberately one object per photo rather than the `image_urls` / `image_alts`
 * pair this replaced: two arrays whose correspondence was positional and
 * unenforced, so a single drifted row silently captioned every photo after it
 * with the previous photo's words — plausible on screen, wrong for exactly the
 * reader alt text exists for (DATA-L4, review 20260802). A caption cannot
 * outlive or slide past its photo when it is a field of it.
 *
 * `alt` is "" when the shop has not written one; the renderer falls back to the
 * generated "{title} — photo {n}" caption (`resolveImageAlt`). It is never null
 * — the empty string *is* "no caption yet", one representation rather than two.
 */
export type CourseGalleryPhoto = {
  url: string;
  alt: string;
};

/**
 * The marketing surface of a course: everything a diver reads before booking,
 * and nothing an operation depends on. Prices, the cert gate, and scheduling
 * live on the course row itself because they carry operational weight; these
 * fields only ever render. Kept as one shape so a DiveDay-published template and
 * a shop's own copy are the same thing (src/db/courses.ts).
 */
export type CourseContent = {
  summary: string | null;
  overview: string | null;
  heroImageUrl: string | null;
  /** Staff-authored alt text for the hero photo; blank falls back to a generated caption. */
  heroImageAlt: string | null;
  /** The gallery, each photo carrying its own caption — never two parallel arrays (DATA-L4). */
  galleryPhotos: CourseGalleryPhoto[];
  durationText: string | null;
  groupSizeText: string | null;
  minimumAge: number | null;
  prerequisiteNote: string | null;
  includes: string[];
  excludes: string[];
  scheduleDays: CourseScheduleDay[];
  faqs: CourseFaq[];
  /** A no-certification-required taster session (Discover Scuba, Try Scuba, …). */
  isIntroCourse: boolean;
};

/**
 * Route segments under `/shop/[slug]/courses/` that are staff pages, not course
 * slugs. The legacy-URL redirect (`LEGACY_PUBLIC_SHOP_REDIRECTS` in
 * src/lib/public-routes.ts) sends exactly one segment under `/courses/` to the
 * diver's namespace, so a course slugged "catalog" would 308 a staff page into
 * `/s/**` and take it out of the auth gate entirely. Both that pattern's
 * negative lookahead and slug minting below refuse these words, so the two
 * halves cannot drift apart.
 *
 * `paths` stays on the list after ADR 20260805-remove-certification-paths
 * removed the builder that used it: the word is retired, not freed. A course
 * minted at that slug would start capturing the redirect for every bookmark
 * and printed link still pointing at the old builder.
 */
export const RESERVED_COURSE_SEGMENTS = new Set(["catalog", "new", "paths"]);

/**
 * A stable, readable URL segment for a course. Collides by design when two
 * courses share a title — the (shop_id, slug) unique index is what catches it,
 * and the caller disambiguates.
 */
export function courseSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  if (!slug) return "course";
  return RESERVED_COURSE_SEGMENTS.has(slug) ? `${slug}-course` : slug;
}

/** One trimmed item per line; blank lines dropped. */
export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Normalizes the FAQ editor's serialized state (`FaqEditor` posts one
 * JSON-encoded array) into `CourseFaq[]`.
 *
 * The same contract as `sanitizeScheduleDays` above, for the same reason: a
 * pair added and then never filled in is dropped rather than refused, and a
 * half-filled one fails the save outright. Which half is missing does not
 * matter here — a question with no answer is the thing a diver would read and
 * get nothing from, and an answer with no question has nowhere to render.
 * Returns null on malformed input or a half-filled pair.
 */
export function sanitizeFaqs(raw: unknown): CourseFaq[] | null {
  const parsed = z.array(faqInputSchema).max(MAX_FAQS).safeParse(raw);
  if (!parsed.success) return null;

  const faqs: CourseFaq[] = [];
  for (const entry of parsed.data) {
    const question = entry.question.trim();
    const answer = entry.answer.trim();
    if (!question && !answer) continue;
    if (!question || !answer) return null;
    faqs.push({ question, answer });
  }
  return faqs;
}

/**
 * A staff-authored caption if there is one, otherwise the caller's already-
 * localized fallback ("{title} — photo {n}"). Kept copy-free (src/lib returns
 * codes/values, not sentences) — the caller resolves the fallback string.
 */
export function resolveImageAlt(caption: string | null | undefined, fallback: string): string {
  const trimmed = caption?.trim();
  return trimmed ? trimmed : fallback;
}

const MAX_COURSE_IMAGES = 8;

/**
 * Gallery links, one per line. Unlike the dive-site splitter this accepts a
 * root-relative path so template content can point at bundled art in
 * public/courses/ without inventing an absolute origin.
 */
export function splitCourseImageUrls(value: string): string[] {
  const urls = [...new Set(parseLines(value))];
  if (urls.length > MAX_COURSE_IMAGES) throw new Error("Choose up to eight images.");
  for (const url of urls) {
    if (url.startsWith("/")) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Each image must be a complete HTTP(S) link or a /path.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Each image must be a complete HTTP(S) link or a /path.");
    }
  }
  return urls;
}

/**
 * A course invoices as two lines on one bill, never as one bundled number.
 *
 * The diver still makes a single payment — but the shop's instruction and the
 * agency's e-learning code are separate goods, and they part ways often enough
 * that arithmetic-by-hand is the wrong answer: a student who already completed
 * e-learning elsewhere should have that line dropped before the invoice goes
 * out (or refunded after, if it already went), and the shop can settle the
 * instruction side on its own when weather or a withdrawal eats the dives.
 *
 * Enrollment assumes the e-learning is included; removing it is the exception,
 * so the price a shop advertises is the sum of both lines.
 */
export type CourseCharge = {
  kind: Extract<OrderLineItemKind, "course_fee" | "e_learning_fee">;
  /**
   * The course's own title — a shop-authored proper noun, not copy. The words
   * *around* it ("— instruction", "— e-learning") are copy and belong to the
   * caller's message bundle, which is why this returns the parts rather than a
   * composed sentence (docs ADR 20260731-domain-layer-copy-leaks).
   */
  courseTitle: string;
  /** An integer count of the shop currency's minor unit (docs ADR 20260731-shop-currency). */
  amountCents: number;
};

export type CoursePricing = {
  title: string;
  priceCents: number | null;
  eLearningPriceCents: number | null;
};

/**
 * The invoice lines for enrolling one student; priced items only.
 *
 * Returns the *parts* of each line — a kind and the course title — never the
 * finished label. The order form composes the words from the staff bundle
 * (`orderLine.*`) and hands the composed string to `createOrder`.
 */
export function courseCharges(course: CoursePricing): CourseCharge[] {
  const charges: CourseCharge[] = [];
  if (course.priceCents !== null) {
    charges.push({
      kind: "course_fee",
      courseTitle: course.title,
      amountCents: course.priceCents,
    });
  }
  if (course.eLearningPriceCents !== null) {
    charges.push({
      kind: "e_learning_fee",
      courseTitle: course.title,
      amountCents: course.eLearningPriceCents,
    });
  }
  return charges;
}

/**
 * One prefilled line on the new-order form, as parts rather than as a
 * sentence. A course line names the course; a trip line names the trip. The
 * form turns the pair into the description staff see (and can edit) before it
 * is frozen onto the invoice.
 */
export type BookingInvoiceLine =
  | {
      kind: Extract<OrderLineItemKind, "course_fee" | "e_learning_fee">;
      courseTitle: string;
      amountCents: number | null;
    }
  | {
      kind: Extract<OrderLineItemKind, "trip_fee">;
      tripTitle: string;
      amountCents: number | null;
    };

/**
 * The lines an order form should start from for one booking. A course session
 * bills its catalog pair; anything else is a single trip fee, whose amount is
 * null when the trip carries no price and staff must type one.
 */
export function bookingInvoiceLines(booking: {
  trip: { title: string; priceCents: number | null };
  course: CoursePricing | null;
}): BookingInvoiceLine[] {
  if (booking.course) {
    // The trip's own price stands in when the catalog entry is unpriced, so a
    // shop that prices per session is not forced through the catalog first.
    const charges = courseCharges({
      ...booking.course,
      priceCents: booking.course.priceCents ?? booking.trip.priceCents,
    });
    if (charges.length > 0) return charges;
  }
  return [
    { kind: "trip_fee", tripTitle: booking.trip.title, amountCents: booking.trip.priceCents },
  ];
}

/**
 * The per-diver amount a pay-at-booking checkout charges: the course's
 * priced pair (with the trip fee standing in for an unpriced catalog entry,
 * as in bookingInvoiceLines) or the plain trip fee. Null means the trip is
 * unpriced and checkout simply doesn't happen — never a $0 charge.
 */
export function perDiverBookingPriceCents(
  trip: { priceCents: number | null },
  course: CoursePricing | null,
): number | null {
  if (course) {
    const total = courseTotalCents({
      ...course,
      priceCents: course.priceCents ?? trip.priceCents,
    });
    if (total !== null) return total;
  }
  return trip.priceCents;
}

/**
 * One payment, both lines: what the diver is asked for at enrollment, or null
 * when the shop has not priced the course at all.
 */
export function courseTotalCents(course: CoursePricing): number | null {
  const charges = courseCharges(course);
  if (charges.length === 0) return null;
  return charges.reduce((sum, charge) => sum + charge.amountCents, 0);
}
