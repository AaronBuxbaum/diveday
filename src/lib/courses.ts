import type { OrderLineItemKind } from "@/db/schema";

/**
 * One block of a course's day-by-day plan: "Day 1 — 8:15am–5:30pm" over a list
 * of what happens in it. `timeRange` is prose, not a parsed clock: a course day
 * runs "8:15am–5:30pm" in one shop and "after the morning boat" in another, and
 * nothing in the app schedules against it — the dated session does that.
 */
export type CourseScheduleDay = {
  title: string;
  timeRange?: string;
  items: string[];
};

export type CourseFaq = { question: string; answer: string };

/**
 * The marketing surface of a course: everything a diver reads before booking,
 * and nothing an operation depends on. Prices, the cert gate, and scheduling
 * live on the course row itself because they carry operational weight; these
 * fields only ever render. Kept as one shape so a Scuba-published template and
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
export const RESERVED_COURSE_SEGMENTS = new Set(["catalog", "new"]);

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

/**
 * Blank-line-separated blocks whose first line is `Day 1 — 8:15am–5:30pm`. The
 * separator is the last em dash or pipe on that line, so a title that contains
 * one ("Day 2 — Confined water — pool") keeps everything before the final
 * separator and reads the time range off the tail.
 */
export function parseScheduleDays(value: string): CourseScheduleDay[] {
  return blocks(value).map(([heading, ...items]) => {
    const separator = Math.max(heading.lastIndexOf("—"), heading.lastIndexOf("|"));
    if (separator <= 0) return { title: heading, items };
    const title = heading.slice(0, separator).trim();
    const timeRange = heading.slice(separator + 1).trim();
    return title && timeRange ? { title, timeRange, items } : { title: heading, items };
  });
}

export function formatScheduleDays(days: CourseScheduleDay[]): string {
  return days
    .map((day) =>
      [day.timeRange ? `${day.title} — ${day.timeRange}` : day.title, ...day.items].join("\n"),
    )
    .join("\n\n");
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
