import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { createPerson } from "./people";
import { bookings } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { emailFreshWaiverLink } from "./waiver-issue";
import { issueWaiverRequest, staleWaiverRecordForToken } from "./waivers";

/**
 * **A seat's dead waiver link rescues only the person it was issued to**
 * (security review S1, attacker review N4). The rescue sends the holder their
 * thread link; a previous holder's link must neither drive that send nor read
 * anything back about the new holder's seat.
 */
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

const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

function configureEmail() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockResolvedValue({ MessageId: "ses-id" });
}

/** A seat, the waiver link issued to its holder, and the instant that link is dead. */
async function seatLink() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "delivered@dive.day",
  });
  if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booked.bookingId });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  return { db, shop, bookingId: booked.bookingId, token: issued.token, after: issued.expiresAt };
}

describe("emailFreshWaiverLink after the seat changed hands", () => {
  it("still rescues the holder it was issued to", async () => {
    configureEmail();
    const { db, token, after } = await seatLink();
    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
  });

  it("refuses a link issued to the seat's previous holder, and sends the new holder nothing", async () => {
    configureEmail();
    const { db, shop, bookingId, token, after } = await seatLink();
    const next = await createPerson(db, {
      shopId: shop.id,
      fullName: "Ines Ruiz",
      email: "ines@dive.day",
      phone: null,
      origin: "counter",
    });
    await db.update(bookings).set({ personId: next.id }).where(eq(bookings.id, bookingId));

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("unavailable");
    expect(sesSend).not.toHaveBeenCalled();
    // The page's rescue card resolves through the same read, so it shows the
    // closed door rather than the shop's rescue.
    await expect(staleWaiverRecordForToken(db, token, after)).resolves.toBeNull();
  });
});
