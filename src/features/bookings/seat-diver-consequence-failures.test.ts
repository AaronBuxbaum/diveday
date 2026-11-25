// @vitest-environment node
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "../../test/db";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

/** Failures injected at the seat's consequences; everything else is real. */
const fail = vi.hoisted(() => ({
  text: null as unknown,
  openStep: false,
  settle: false,
}));
const logged = vi.hoisted(() => vi.fn());

vi.mock("./seat-confirmation-text", () => ({
  textStaffSeatingConfirmation: async () => {
    if (fail.text !== null) throw fail.text;
    return { status: "no_number" } as const;
  },
}));
vi.mock("../../db/waiver-issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/waiver-issue")>();
  return {
    ...actual,
    openJoinSignStep: async (...args: Parameters<typeof actual.openJoinSignStep>) => {
      if (fail.openStep) throw new Error("step down");
      return actual.openJoinSignStep(...args);
    },
    settleJoinWaiverDelivery: async (
      ...args: Parameters<typeof actual.settleJoinWaiverDelivery>
    ) => {
      if (fail.settle) throw new Error("settle down");
      return actual.settleJoinWaiverDelivery(...args);
    },
  };
});
vi.mock("../../lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/log")>();
  return { ...actual, log: logged };
});

import { people, personRoles } from "../../db/schema/index";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { seatDiver } from "./seat-diver";

const ctx = fileScopedShopContext({ realShop: true });

async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  return { db, shop, open, actorPersonId: staff.id };
}

function deliverableEmailEnv() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockReset().mockResolvedValue({ MessageId: "ses-id" });
}

afterEach(() => {
  vi.unstubAllEnvs();
  fail.text = null;
  fail.openStep = false;
  fail.settle = false;
  logged.mockReset();
});

async function seat(fullName: string) {
  const { db, shop, open, actorPersonId } = await context();
  const result = await seatDiver(db, {
    shopId: shop.id,
    tripId: open.id,
    actorPersonId,
    diver: { fullName, email: "delivered@dive.day" },
    entry: "roster",
    refusals: "specific",
  });
  if (!result.ok) throw new Error("expected the diver to be seated");
  return result;
}

/**
 * **A staff seating's consequences fail one at a time**: the seat stands, the
 * confirmation says what actually reached the diver, and the failure is
 * logged with a code, never the diver's details.
 */
describe("seatDiver when a consequence throws", () => {
  it("logs a thrown text by its error's name, and keeps the email's word", async () => {
    deliverableEmailEnv();
    fail.text = Object.assign(new Error("sns down"), { name: "SnsThrottled" });

    const result = await seat("Text Throws Tara");

    expect(result).toMatchObject({ confirmation: "sent", reached: ["email"] });
    expect(logged).toHaveBeenCalledWith("booking.staff_confirmation_text_failed", "error", {
      bookingId: result.bookingId,
      errorCode: "SnsThrottled",
    });
  });

  it("logs a thrown non-error as unknown_error", async () => {
    deliverableEmailEnv();
    fail.text = "a bare string";

    const result = await seat("Text Throws Tomas");

    expect(logged).toHaveBeenCalledWith("booking.staff_confirmation_text_failed", "error", {
      bookingId: result.bookingId,
      errorCode: "unknown_error",
    });
  });

  it("keeps a sent confirmation sent when the waiver's settling throws after it", async () => {
    deliverableEmailEnv();
    fail.settle = true;

    const result = await seat("Settle Throws Sara");

    expect(result).toMatchObject({ confirmation: "sent", reached: ["email"], waiver: "failed" });
  });

  it("says not_sent when the seating throws before anything went", async () => {
    deliverableEmailEnv();
    fail.openStep = true;

    const result = await seat("Step Throws Stan");

    expect(result).toMatchObject({ confirmation: "not_sent", reached: [] });
    expect(sesSend).not.toHaveBeenCalled();
  });
});
