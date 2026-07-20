import type { OrderLineItemKind } from "@/db/schema";

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
 * One payment, both lines: what the diver is asked for at enrollment, or null
 * when the shop has not priced the course at all.
 */
export function courseTotalCents(course: CoursePricing): number | null {
  const charges = courseCharges(course);
  if (charges.length === 0) return null;
  return charges.reduce((sum, charge) => sum + charge.amountCents, 0);
}
