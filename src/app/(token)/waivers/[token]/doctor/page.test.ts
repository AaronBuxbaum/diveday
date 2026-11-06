import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { mintCapability } from "@/db/capabilities";
import { people } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { openWaiverInThread } from "@/db/waivers";
import { completeWaiver } from "@/db/waivers-completion";
import {
  claimedDevice,
  clearAnswers,
  issueCounterLink,
  medicalReferralAnswers,
  openOnDevice,
} from "@/db/waivers-test-fixtures";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../counter-device", () => ({ counterDevice: vi.fn(async () => undefined) }));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));

const { getDb } = await import("@/db/client");
const { counterDevice } = await import("../counter-device");
const { default: PartyDoorDoctorPage } = await import("./page");

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * **A party member's doctor's page is on their door** (issue #4003). A member
 * is sent no readiness link, so the emailed door is the only place a referral
 * can lead; a counter QR, the shop's tablet, gets none.
 */
describe("the party door's doctor's page", () => {
  async function member() {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Nora Quinn",
        email: "nora.doctor@dive.day",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Theo Marsh",
        email: "theo.doctor@dive.day",
      },
    ]);
    if (!party.ok) throw new Error("party failed");
    const seat = party.bookings[1];
    if (!seat) throw new Error("member missing");
    await db.update(people).set({ dateOfBirth: "1984-03-09" }).where(eq(people.id, seat.personId));
    return { db, shop, trip, seat };
  }

  async function signedThrough(token: string, answers: typeof clearAnswers) {
    const door = await openOnDevice(ctx.db, token);
    if (door?.door !== "counter") throw new Error("door does not open");
    const signed = await completeWaiver(ctx.db, door.key, {
      signerName: "Theo Marsh",
      agreed: true,
      medicalAnswers: answers,
    });
    if (!signed.ok) throw new Error(`signing refused: ${signed.reason}`);
    vi.mocked(counterDevice).mockResolvedValue(claimedDevice(token));
  }

  const render = async (token: string) =>
    renderToStaticMarkup(await PartyDoorDoctorPage({ params: Promise.resolve({ token }) }));

  async function partyDoor() {
    const { db, shop, trip, seat } = await member();
    const opened = await openWaiverInThread(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      expectedPersonId: seat.personId,
      expectedTripId: trip.id,
    });
    if (!opened.ok) throw new Error("release refused");
    const door = await mintCapability(db, {
      purpose: "party_waiver_link",
      shopId: shop.id,
      subjectId: opened.recordId,
    });
    return { ...door, seat, shop };
  }

  it("prints the doctor's page for a referred member on the phone that holds the door", async () => {
    const { token } = await partyDoor();
    await signedThrough(token, medicalReferralAnswers);
    const html = await render(token);
    expect(html).toContain("Theo Marsh");
    expect(html).toContain('name="birthdate"');
    expect(html).not.toContain("1984");
  });

  it("goes back to the receipt for a member who was not referred", async () => {
    const { token } = await partyDoor();
    await signedThrough(token, clearAnswers);
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });

  it("opens nothing on another phone", async () => {
    const { token } = await partyDoor();
    await signedThrough(token, medicalReferralAnswers);
    vi.mocked(counterDevice).mockResolvedValue("another-phone");
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });

  it("gives a counter QR no doctor's page: the desk prints the form", async () => {
    const { db, shop, seat } = await member();
    const { token } = await issueCounterLink(db, { shopId: shop.id, bookingId: seat.bookingId });
    await signedThrough(token, medicalReferralAnswers);
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });
});
