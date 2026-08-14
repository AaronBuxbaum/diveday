import type { DbExecutor } from "./client";
import { courseInquiries } from "./schema";
import { at, dateAt } from "./seed-clock";

/**
 * Divers asking for a *dive* on a date the board has nothing on — the half of
 * `course_inquiries` that names no course, written from the shop's own schedule
 * page ("Nothing on a date that works?").
 *
 * Its own scenario rather than rows wedged into `seed-course-inquiries.ts`:
 * that one exists to represent the three states of the `person_id` link, and
 * this one exists to make the requests list say something. What it has to show
 * is the grouping (src/lib/date-requests.ts), which needs at least:
 *
 * - **two people on the same day**, so a group's count is more than one and a
 *   shop can see the departure waiting to be scheduled;
 * - **one of them by their alternate date**, so the "could make it / asked for
 *   it first" distinction renders (the lighter row);
 * - **one flexible request anchored a day or two away**, which is how a nearby
 *   request joins a group it never named;
 * - **one with no date at all**, which lands in the group at the foot.
 *
 * Every row is unlinked (`person_id` null): these are strangers off the public
 * page, which is what most of them are. Dates are `dateAt` offsets so the demo
 * shop's requests stay ahead of the frozen e2e clock rather than drifting into
 * the past.
 */
export async function seedDateRequests(db: DbExecutor, shopId: string): Promise<void> {
  await db.insert(courseInquiries).values([
    {
      shopId,
      courseId: null,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      interest: "A two-tank on the wrecks",
      personId: null,
      name: "Tomás Ferreira",
      email: "tomas.ferreira@example.com",
      phone: null,
      experienceLevel: "certified" as const,
      timing: "Any Saturday, ideally the first one you can do",
      preferredDate: dateAt(12),
      alternateDate: dateAt(19),
      dateFlexible: false,
      divers: 2,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      message: "Two of us, both AOW, we would love the deeper wreck if the current allows.",
      createdAt: at(-4, 20, 15),
    },
    {
      shopId,
      courseId: null,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      interest: "A shallow reef morning",
      personId: null,
      name: "Hannah Okafor",
      email: "hannah.okafor@example.com",
      phone: "+1-305-555-0433",
      experienceLevel: "lapsed" as const,
      timing: null,
      // Names the 19th first, so the 12th group holds her only as a fallback.
      preferredDate: dateAt(19),
      alternateDate: dateAt(12),
      dateFlexible: false,
      divers: 1,
      message: null,
      createdAt: at(-3, 9, 2),
    },
    {
      shopId,
      courseId: null,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      interest: "A night dive, if you still run them",
      personId: null,
      name: "Dee Whitlock",
      email: null,
      phone: "+1-786-555-0421",
      experienceLevel: "certified" as const,
      timing: "We are ashore all week",
      // A day either side of the 12th, and flexible — so it travels into that
      // group without ever having named it.
      preferredDate: dateAt(13),
      alternateDate: null,
      dateFlexible: true,
      divers: 3,
      message: null,
      createdAt: at(-2, 18, 40),
    },
    {
      shopId,
      courseId: null,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      interest: "Whatever is best in October",
      personId: null,
      name: "Rae Lindqvist",
      email: "rae.lindqvist@example.com",
      phone: null,
      experienceLevel: "never" as const,
      timing: "Some week in October — we have not booked flights yet",
      preferredDate: null,
      alternateDate: null,
      dateFlexible: true,
      divers: 2,
      // i18n-exempt: what a diver typed into the shop's own request form, stored verbatim — a fixture value, not product copy
      message: "Neither of us has dived. Happy to take whatever you would put beginners on.",
      createdAt: at(-1, 12, 25),
    },
  ]);
}
