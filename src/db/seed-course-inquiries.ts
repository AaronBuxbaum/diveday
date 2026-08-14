import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { courseInquiries, people } from "./schema";
import { at, dateAt } from "./seed-clock";

/**
 * Three course leads off the public course pages — the shape a shop's inquiry
 * pile actually has, which is not "three rows that all look the same".
 *
 * The point of seeding them is the `person_id` column and its three states
 * (ADR 20260802-diver-data-erasure, and the DATA-H1 residue the 2026-08-02
 * review left open). It is resolved at capture time by **exact email match**
 * against a live diver of this shop, never fuzzily and never from a phone
 * number, and it is never back-filled. So a lead can be:
 *
 * - **linked** — an existing diver asking about their next card, matched on the
 *   address already on their record;
 * - **unlinked with an address** — a stranger, which is what most leads are;
 * - **unlinked with no address at all** — someone who left a phone number only.
 *   This is the case the residue is about: nothing can ever tie that row to a
 *   person, so an erasure request from the human behind it will not reach it,
 *   and closing that needs a human saying "this lead is that diver".
 *
 * Until this scenario existed all three states were unrepresented, which meant
 * `course_inquiries.csv` in the export bundle was a header row with nothing
 * under it on every demo (DATA-A10).
 *
 * The rows are written directly rather than through `recordCourseInquiry`
 * (src/db/course-inquiries.ts) because that helper takes the app's `AppDb` and
 * the seed runs on a plain executor. The matching rule is reproduced here on
 * exactly one row, by looking the diver up by the address the seed itself gave
 * them — never by re-implementing the fuzzy version the helper deliberately
 * refuses.
 */
export async function seedCourseInquiries(
  db: DbExecutor,
  shopId: string,
  ctx: { courseIdByTitle: Map<string, string> },
): Promise<void> {
  const advancedCourseId = ctx.courseIdByTitle.get("Advanced Open Water Diver");
  const openWaterCourseId = ctx.courseIdByTitle.get("Open Water Diver");
  const nitroxCourseId = ctx.courseIdByTitle.get("Nitrox Diver");

  // A diver the shop already knows, asking about their next card. Live rows
  // only — the same restriction `livePersonIdForEmail` applies, and for the
  // same reason: linking a lead to a removed duplicate would point a later
  // erasure at the wrong record.
  const [regular] = await db
    .select({ id: people.id, email: people.email })
    .from(people)
    .where(
      and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma"), isNull(people.deletedAt)),
    )
    .limit(1);

  const rows = [
    ...(advancedCourseId && regular?.email
      ? [
          {
            shopId,
            courseId: advancedCourseId,
            personId: regular.id,
            name: "Priya Sharma",
            email: regular.email.toLowerCase(),
            phone: null,
            experienceLevel: "certified" as const,
            timing: "Next month, if you run one",
            // A course request with a date on it: the requests list groups it
            // beside the dive requests asking for the same day.
            preferredDate: dateAt(12),
            alternateDate: null,
            dateFlexible: true,
            divers: 1,
            // i18n-exempt: what a diver typed into the shop's own inquiry form, stored verbatim — a fixture value, not product copy
            message: "Loved the Benwood boat. Ready for the deep dives whenever you have space.",
            createdAt: at(-6, 19, 12),
          },
        ]
      : []),
    ...(openWaterCourseId
      ? [
          {
            shopId,
            courseId: openWaterCourseId,
            personId: null,
            name: "Marisol Vega",
            // Nobody at this shop holds this address, so the lead stays
            // unlinked — the ordinary case, and not a bug.
            email: "marisol.vega@example.com",
            phone: "+1-305-555-0410",
            experienceLevel: "never" as const,
            timing: "Some weekend in the next couple of months",
            preferredDate: dateAt(26),
            alternateDate: dateAt(33),
            dateFlexible: false,
            divers: 2,
            // i18n-exempt: what a diver typed into the shop's own inquiry form, stored verbatim — a fixture value, not product copy
            message:
              "My partner and I have never dived. Is the three-day course beginner-friendly?",
            createdAt: at(-3, 21, 41),
          },
        ]
      : []),
    ...(nitroxCourseId
      ? [
          {
            shopId,
            courseId: nitroxCourseId,
            personId: null,
            // No name and no address: a phone number typed on a dock in a
            // hurry. Unreachable by any erasure that starts from an email.
            name: null,
            email: null,
            phone: "+1-786-555-0411",
            experienceLevel: "lapsed" as const,
            timing: null,
            divers: null,
            // i18n-exempt: what a diver typed into the shop's own inquiry form, stored verbatim — a fixture value, not product copy
            message: "Certified in 2014, haven't dived since. Call me?",
            createdAt: at(-1, 8, 5),
          },
        ]
      : []),
  ];

  if (rows.length > 0) await db.insert(courseInquiries).values(rows);
}
