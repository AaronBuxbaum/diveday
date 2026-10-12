import { courseCharges } from "@/lib/courses";
import type { publicTripRecord } from "./booking-page-wave";

type PublicTrip = NonNullable<Awaited<ReturnType<typeof publicTripRecord>>>;

/**
 * The course's two fees the booking form's money block states, resolved on the
 * server so the course-fee arithmetic (src/lib/courses.ts) never ships to the
 * browser. Both null on a departure that is no course session.
 */
export function bookingCourseFees(trip: Pick<PublicTrip, "priceCents" | "course">): {
  courseFeeCents: number | null;
  eLearningFeeCents: number | null;
} {
  const courseBreakdown = trip.course
    ? courseCharges({
        title: trip.course.title,
        priceCents: trip.course.priceCents ?? trip.priceCents,
        eLearningPriceCents: trip.course.eLearningPriceCents,
      })
    : [];
  const courseFeeCents =
    courseBreakdown.find((line) => line.kind === "course_fee")?.amountCents ?? null;
  const eLearningFeeCents =
    courseBreakdown.find((line) => line.kind === "e_learning_fee")?.amountCents ?? null;
  return { courseFeeCents, eLearningFeeCents };
}
