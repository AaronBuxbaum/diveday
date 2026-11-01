import { and, asc, eq, gt, inArray, isNotNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import {
  listCourseForms,
  recordPaperCourseForm,
  requiredCourseFormsForTrips,
} from "./course-forms";
import { bookings, courseFormVersions, people, trips } from "./schema";
import { withinDeskHours } from "./seed-clock";
import { signedAtFor } from "./seed-waiver-evidence";
import { liveTrip } from "./trips-live";

/**
 * **The demo's course forms carry the shop's own words** (fourth review,
 * item 53). A course template names the forms its agency expects by title
 * only (DiveDay ships no agency wording, H-20261007-request-supported-c-card), so every seeded form started
 * empty and the demo, presented as a running shop, opened Waivers on three
 * "Needs your text" badges and Courses on "17 courses need their agency form
 * wording."
 *
 * These are the shop's own statements under the agency's titles, written for
 * the demo: not any agency's text. They use the placeholders a form fills per
 * student (`fillCourseFormText`), so the signing page shows them working.
 *
 * Wording a form starts asking every student on a session that has not
 * started, so each student already booked on one has signed on paper at the
 * desk (`recordPaperCourseForm`, the roster's own door), in desk hours. That
 * keeps every seeded seat exactly as ready as it was; a seat booked from here
 * on owes the forms, which is what the product does.
 */
const SHOP_FORM_WORDING: Record<string, string> = {
  "Release of Liability/Assumption of Risk/Non-agency Acknowledgment Form – General Training": [
    "{courseTitle} at {shopName}",
    "",
    "I understand that this course includes training in a pool and in open water, and that diving and boat travel carry risks, including decompression illness, barotrauma, drowning and injury from equipment or marine life.",
    "",
    "I understand that {shopName} and my instructors ({instructorNames}) run this course as an independent business, and that the training agency whose card I may earn is not responsible for how it is run.",
    "",
    "I will tell my instructor before any session if my health changes. Knowing these risks, I accept them and release {shopName}, its instructors and crew from any claim arising from my training, except for gross negligence or willful misconduct.",
  ].join("\n"),
  "Standard Safe Diving Practices Statement of Understanding": [
    "What {shopName} asks of every student on {courseTitle}",
    "",
    "I will dive only when I feel fit to, and never after alcohol or drugs.",
    "",
    "I will plan every dive with my buddy, stay with my buddy, and dive within the limits of my training and experience.",
    "",
    "I will check my equipment before every dive, ascend slowly, make a safety stop, and wait before flying after diving.",
    "",
    "I will keep learning after this course, and refresh my skills with a professional after time away from the water.",
  ].join("\n"),
  "Youth Diving: Responsibility and Risks Acknowledgment": [
    "{courseTitle} at {shopName}: for a student aged 11 or under",
    "",
    "I have talked with my parent or guardian about the risks of diving, including decompression illness, barotrauma and drowning, and about why I must follow the rules my instructors ({instructorNames}) give me.",
    "",
    "I will always dive with an adult, stay within the depth my instructor sets, never hold my breath, and tell an adult straight away if I feel unwell, cold or scared.",
    "",
    "My parent or guardian has read this with me and signs it beside me.",
  ].join("\n"),
  "Continuing Education Administrative Document": [
    "{courseTitle} at {shopName}",
    "",
    "I hold the certification this course requires, and I will dive within the limits of my training and of this course's plan as briefed by {instructorNames}.",
    "",
    "I understand that training dives carry risks, including decompression illness, barotrauma and drowning, and I will tell my instructor before any session if my health changes.",
    "",
    "I understand that {shopName} runs this course as an independent business. Knowing these risks, I accept them and release {shopName}, its instructors and crew from any claim arising from my training, except for gross negligence or willful misconduct.",
  ].join("\n"),
};

export async function seedCourseFormWording(
  db: DbExecutor,
  shopId: string,
  ctx: { recordedByPersonId: string },
): Promise<void> {
  // The forms' own doors take the app database; the seed runs on it or on
  // one transaction, and both carry `transaction`.
  const app = db as AppDb;
  // In place, on the version the seed created: a trading shop's form has had
  // these words since it was set up, so it reads "version 1" with them.
  for (const form of await listCourseForms(db, shopId)) {
    const body = SHOP_FORM_WORDING[form.title];
    if (!body) continue;
    await db
      .update(courseFormVersions)
      .set({ body })
      .where(and(eq(courseFormVersions.shopId, shopId), eq(courseFormVersions.formId, form.id)));
  }

  const now = nowDate();
  const sessions = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        isNotNull(trips.courseId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        liveTrip(),
      ),
    );
  const required = await requiredCourseFormsForTrips(
    db,
    shopId,
    sessions.map((session) => session.id),
    now,
  );
  const tripIds = [...required.keys()];
  if (tripIds.length === 0) return;
  const students = await db
    .select({
      bookingId: bookings.id,
      tripId: bookings.tripId,
      fullName: people.fullName,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, tripIds),
        ne(bookings.status, "cancelled"),
      ),
    )
    // A fixed order, so each student's signing time is a function of the seed.
    .orderBy(asc(people.fullName), asc(bookings.id));
  let signing = 0;
  for (const student of students) {
    for (const form of required.get(student.tripId) ?? []) {
      // Each form signed at the desk on its own visit, while the desk was
      // open, spread over the past weeks the way the waiver evidence is.
      const signedAt = withinDeskHours(signedAtFor(signing));
      signing += 1;
      const record = (guardian?: { name: string; relationship: string }) =>
        recordPaperCourseForm(app, {
          shopId,
          bookingId: student.bookingId,
          formId: form.formId,
          recordedByPersonId: ctx.recordedByPersonId,
          paperCopyConfirmed: true,
          now: signedAt,
          ...(guardian ? { guardian } : {}),
        });
      let outcome = await record();
      if (!outcome.ok && outcome.reason === "guardian_required") {
        outcome = await record({ name: guardianNameFor(student.fullName), relationship: "parent" });
      }
      // A seat held for staff to confirm who it is takes no form yet.
      if (!outcome.ok && outcome.reason !== "unavailable") {
        throw new Error(`seed: a course form stayed unsigned (${outcome.reason})`);
      }
    }
  }
}

/**
 * A minor's form carries a parent's co-signature, as a paper one does. The
 * seed has no parent on file, so it invents one sharing the student's surname
 * under a given name ("Alex") that reads as either parent. It must never be
 * the student's own name: `recordPaperCourseForm` refuses a co-signer whose
 * name matches the diver's with `guardian_name_matches_diver` unless staff
 * attest to the namesake, and the seed would throw. A student called Alex
 * gets "Sam".
 */
export function guardianNameFor(studentFullName: string): string {
  const parts = studentFullName.trim().split(/\s+/);
  const surname = parts.at(-1) ?? studentFullName;
  const given = parts[0]?.toLowerCase() === "alex" ? "Sam" : "Alex";
  return `${given} ${surname}`;
}
