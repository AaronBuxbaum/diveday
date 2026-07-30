import { z } from "zod";
import type { OrderLineItemKind } from "@/db/schema";

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

function formatClockTime(value: string): string | null {
  if (!CLOCK_TIME_RE.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  const reference = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(reference);
}

/** The day's displayed hours: a real clock range, a single clock time, the free-text note, or nothing. */
export function formatScheduleDayTime(day: CourseScheduleDay): string | undefined {
  const start = day.startTime ? formatClockTime(day.startTime) : null;
  const end = day.endTime ? formatClockTime(day.endTime) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return day.timeNote?.trim() || undefined;
}

/** Caps enforced both here and by DayByDayEditor's "Add day"/"Add item" buttons, so a save can never build a schedule the server would reject. */
export const MAX_SCHEDULE_DAYS = 30;
export const MAX_SCHEDULE_DAY_ITEMS = 20;

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
 * Caps enforced both here and by the path builder's "Add a course" control, so
 * a save can never build a path the server would reject. Thirty rungs is far
 * past any real progression — it exists to bound the payload, not to shape it.
 */
export const MAX_PATH_STEPS = 30;

/** One rung as the builder serializes it: a catalog course id and the shop's note. */
export type CoursePathStepDraft = { courseId: string; note: string };

const pathStepInputSchema = z.object({
  courseId: z.uuid(),
  note: z.string().max(200).optional().default(""),
});

/**
 * Normalizes the path builder's serialized state (one JSON-encoded array in a
 * hidden field) into ordered step drafts. Returns null on malformed input —
 * anything that is not an array of `{courseId, note}` — so a save fails loudly
 * rather than silently dropping a shop's rungs. Duplicate courses collapse to
 * their first appearance; the database's `(path_id, course_id)` unique index
 * says the same thing, and collapsing here keeps the error out of the shop's face.
 */
export function sanitizePathSteps(raw: unknown): CoursePathStepDraft[] | null {
  const parsed = z.array(pathStepInputSchema).max(MAX_PATH_STEPS).safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const steps: CoursePathStepDraft[] = [];
  for (const step of parsed.data) {
    if (seen.has(step.courseId)) continue;
    seen.add(step.courseId);
    steps.push({ courseId: step.courseId, note: step.note.trim() });
  }
  return steps;
}

export type CourseFaq = { question: string; answer: string };

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
  imageUrls: string[];
  durationText: string | null;
  groupSizeText: string | null;
  minimumAge: number | null;
  prerequisiteNote: string | null;
  includes: string[];
  excludes: string[];
  scheduleDays: CourseScheduleDay[];
  faqs: CourseFaq[];
};

/**
 * Route segments under /shop/[slug]/courses/ that are staff pages, not course
 * slugs. The public route matcher exempts exactly one segment under /courses/,
 * so a course slugged "catalog" would quietly hand a signed-out visitor a staff
 * page. Both the matcher (src/lib/auth.config.ts) and slug minting refuse them.
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

/** Split a textarea into blocks on blank lines, dropping empty ones. */
function blocks(value: string): string[][] {
  return value
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);
}

/** One trimmed item per line; blank lines dropped. */
export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Blank-line-separated blocks: first line the question, the rest the answer. */
export function parseFaqs(value: string): CourseFaq[] {
  return blocks(value)
    .map(([question, ...answer]) => ({ question, answer: answer.join(" ") }))
    .filter((faq) => faq.answer.length > 0);
}

export function formatFaqs(faqs: CourseFaq[]): string {
  return faqs.map((faq) => `${faq.question}\n${faq.answer}`).join("\n\n");
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
  description: string;
  amountCents: number;
};

export type CoursePricing = {
  title: string;
  priceCents: number | null;
  eLearningPriceCents: number | null;
};

/** The invoice lines for enrolling one student; priced items only. */
export function courseCharges(course: CoursePricing): CourseCharge[] {
  const charges: CourseCharge[] = [];
  if (course.priceCents !== null) {
    charges.push({
      kind: "course_fee",
      description: `${course.title} — instruction`,
      amountCents: course.priceCents,
    });
  }
  if (course.eLearningPriceCents !== null) {
    charges.push({
      kind: "e_learning_fee",
      description: `${course.title} — e-learning`,
      amountCents: course.eLearningPriceCents,
    });
  }
  return charges;
}

/**
 * The lines an order form should start from for one booking. A course session
 * bills its catalog pair; anything else is a single trip fee, whose amount is
 * null when the trip carries no price and staff must type one.
 */
export function bookingInvoiceLines(booking: {
  trip: { title: string; priceCents: number | null };
  course: CoursePricing | null;
}): Array<{ kind: OrderLineItemKind; description: string; amountCents: number | null }> {
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
    { kind: "trip_fee", description: booking.trip.title, amountCents: booking.trip.priceCents },
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
