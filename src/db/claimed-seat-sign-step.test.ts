import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import * as readinessDb from "./readiness";
import { bookings, waiverRecords } from "./schema";
import {
  claimPartySeat,
  claimPartySeatRecord,
  issuePartySeatClaims,
  settleClaimedSeat,
} from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";
import { issueWaiverOnJoin } from "./waiver-issue";
import { threadWaiverKey } from "./waivers";

/**
 * **A claimed seat signs in its thread** (issue #2743, ADR
 * 20261105-waiver-folds-into-the-thread). An adult party member is mailed
 * their seat's release on their own thread link, as any booker is. Claiming
 * the seat sends the claimant one confirmation whose Sign step carries the
 * release on the claimant's own readiness link.
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

const ORIGIN = "https://diveday.example";
const MEMBER = "member.2743@dive.day";
const DOOR = /\/waivers\//;
const SIGN_STEP = /\/ready\/[\w.-]+\/waiver/;

function configureMail() {
  vi.stubEnv("APP_HOST", ORIGIN);
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockResolvedValue({ MessageId: "ses-2743" });
}

function mailTo(to: string): string[] {
  return sesSend.mock.calls.flatMap(([command]) => {
    const input = (command as SendEmailCommand).input;
    if (input.Destination?.ToAddresses?.[0] !== to) return [];
    const content = input.Content?.Simple?.Body;
    return [`${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`];
  });
}

/** A public party whose member was mailed their release, before anyone claims the seat. */
async function memberWithRelease() {
  configureMail();
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora.2743@dive.day",
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Theo Marsh", email: MEMBER },
  ]);
  if (!party.ok) throw new Error(`party failed: ${party.reason}`);
  const [lead, member] = party.bookings;
  if (!lead || !member) throw new Error("party seats missing");
  await issueWaiverOnJoin(db, shop.id, member.bookingId);
  const mailed = mailTo(MEMBER)[0] ?? "";
  // The member's own thread link, never a waiver-only door.
  if (!SIGN_STEP.test(mailed) || DOOR.test(mailed)) throw new Error("no thread link mailed");
  sesSend.mockClear();
  return { db, shop, lead, member };
}

async function claimAs(
  input: Awaited<ReturnType<typeof memberWithRelease>>,
  claimant = { fullName: "Theo Marsh", email: MEMBER },
) {
  const seats = await issuePartySeatClaims(input.db, {
    shopId: input.shop.id,
    leadBookingId: input.lead.bookingId,
  });
  const claim = seats.find((seat) => seat.bookingId === input.member.bookingId)?.claim;
  if (!claim) throw new Error("no claim link for the member seat");
  const claimed = await claimPartySeat(input.db, { token: claim.token, ...claimant });
  if (!claimed.ok) throw new Error(`claim failed: ${claimed.reason}`);
  return claimed;
}

describe("a party seat after its claim (issue 2743)", () => {
  it("leaves the release itself on the seat, signable from the claimant's thread", async () => {
    const party = await memberWithRelease();
    const before = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });

    await claimAs(party);

    const after = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });
    expect(after?.recordId).toBe(before?.recordId);
    // One mail: the claimant's confirmation, its Sign step on the thread link.
    const mail = mailTo(MEMBER);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatch(SIGN_STEP);
    expect(mail[0]).not.toMatch(DOOR);
  });

  it("carries a fresh release as the Sign step when someone else claims the seat", async () => {
    const party = await memberWithRelease();
    const claimant = "ines.sign.2743@dive.day";
    await claimAs(party, { fullName: "Ines Vidal", email: claimant });

    const mail = mailTo(claimant);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatch(SIGN_STEP);
    expect(mail[0]).not.toMatch(DOOR);
    const key = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });
    if (!key) throw new Error("no release for the claimant");
    const [fresh] = await party.db
      .select({ personId: waiverRecords.personId })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, key.recordId));
    const [seat] = await party.db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, party.member.bookingId));
    expect(fresh?.personId).toBe(seat?.personId);
    expect(seat?.personId).not.toBe(party.member.personId);
  });

  it("points no held claim at a Sign step it cannot open yet", async () => {
    const party = await memberWithRelease();
    // The member's address, a different name: the seat is held for the desk.
    await claimAs(party, { fullName: "T. Marsh-Ortega", email: MEMBER });

    expect(mailTo(MEMBER).join("\n")).not.toMatch(SIGN_STEP);
  });

  it("still sends the confirmation when opening the Sign step fails", async () => {
    const party = await memberWithRelease();
    const seats = await issuePartySeatClaims(party.db, {
      shopId: party.shop.id,
      leadBookingId: party.lead.bookingId,
    });
    const claim = seats.find((seat) => seat.bookingId === party.member.bookingId)?.claim;
    if (!claim) throw new Error("no claim link for the member seat");
    const claimed = await claimPartySeatRecord(party.db, {
      token: claim.token,
      fullName: "Theo Marsh",
      email: MEMBER,
    });
    if (!claimed.ok) throw new Error("claim failed");
    vi.spyOn(readinessDb, "getBookingReadiness").mockRejectedValueOnce(new Error("read failed"));

    await settleClaimedSeat(party.db, claimed);

    expect(mailTo(MEMBER).join("\n")).toMatch(/\/ready\//);
  });
});
