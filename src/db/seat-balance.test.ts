import { describe, expect, it } from "vitest";
import { seatBalanceOwedCents, seatListPriceCents } from "@/lib/deposits";
import { seatBalanceOwedCentsFromJoinedRow } from "./seat-balance";

const trip = { priceCents: 12_000, snorkelerPriceCents: 4_500, riderPriceCents: 0 };

const cases: Array<{
  name: string;
  input: Parameters<typeof seatBalanceOwedCentsFromJoinedRow>[0];
}> = [
  {
    name: "null course sentinel ignores joined price fields and missing payment owes full trip fare",
    input: {
      trip,
      participantType: "diver",
      courseTitle: null,
      coursePriceCents: 60_000,
      courseELearningPriceCents: 15_000,
      paymentStatus: null,
      paymentAmountCents: null,
    },
  },
  {
    name: "present course prices an unpaid diver",
    input: {
      trip,
      participantType: "diver",
      courseTitle: "Open Water",
      coursePriceCents: 45_000,
      courseELearningPriceCents: 15_000,
      paymentStatus: "unpaid",
      paymentAmountCents: null,
    },
  },
  {
    name: "present course keeps independently nullable price columns",
    input: {
      trip,
      participantType: "diver",
      courseTitle: "eLearning only",
      coursePriceCents: null,
      courseELearningPriceCents: 15_000,
      paymentStatus: "deposit_paid",
      paymentAmountCents: 5_000,
    },
  },
  {
    name: "snorkeler uses its own fare despite course pricing",
    input: {
      trip,
      participantType: "snorkeler",
      courseTitle: "Open Water",
      coursePriceCents: 45_000,
      courseELearningPriceCents: 15_000,
      paymentStatus: "deposit_paid",
      paymentAmountCents: null,
    },
  },
  {
    name: "zero rider fare returns no balance",
    input: {
      trip,
      participantType: "rider",
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus: null,
      paymentAmountCents: null,
    },
  },
  {
    name: "null participant fare returns no balance",
    input: {
      trip: { priceCents: null, snorkelerPriceCents: null, riderPriceCents: null },
      participantType: "diver",
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus: "unpaid",
      paymentAmountCents: null,
    },
  },
  ...["paid", "waived", "refunded"].map((paymentStatus) => ({
    name: `${paymentStatus} payment returns no balance`,
    input: {
      trip,
      participantType: "diver" as const,
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus,
      paymentAmountCents: 12_000,
    },
  })),
  {
    name: "deposit with null amount subtracts zero",
    input: {
      trip,
      participantType: "diver",
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus: "deposit_paid",
      paymentAmountCents: null,
    },
  },
  {
    name: "deposit covering full fare returns no balance",
    input: {
      trip,
      participantType: "diver",
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus: "deposit_paid",
      paymentAmountCents: 12_000,
    },
  },
  {
    name: "falsy payment status retains missing-payment behavior",
    input: {
      trip,
      participantType: "diver",
      courseTitle: null,
      coursePriceCents: null,
      courseELearningPriceCents: null,
      paymentStatus: "",
      paymentAmountCents: 2_000,
    },
  },
];

describe("seatBalanceOwedCentsFromJoinedRow", () => {
  it.each(cases)("matches the previous mapping for $name", ({ input }) => {
    const course =
      input.courseTitle !== null
        ? {
            title: input.courseTitle,
            priceCents: input.coursePriceCents,
            eLearningPriceCents: input.courseELearningPriceCents,
          }
        : null;
    const expected = seatBalanceOwedCents(
      seatListPriceCents(input.trip, course, input.participantType),
      input.paymentStatus
        ? { status: input.paymentStatus, amountCents: input.paymentAmountCents }
        : null,
    );

    expect(seatBalanceOwedCentsFromJoinedRow(input)).toBe(expected);
  });
});
