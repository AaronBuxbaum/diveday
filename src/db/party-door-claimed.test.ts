import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { mintCapability } from "./capabilities";
import * as readinessDb from "./readiness";
import { bookings, capabilities, waiverRecords } from "./schema";
import {
  claimPartySeat,
  claimPartySeatRecord,
  issuePartySeatClaims,
  settleClaimedSeat,
} from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";
import { emailFreshWaiverLink, issueWaiverOnJoin } from "./waiver-issue";
import { claimedSeatDoor, staleWaiverRecordForToken, threadWaiverKey } from "./waivers";
import { completeWaiver } from "./waivers-completion";
import { clearAnswers, openOnDevice } from "./waivers-test-fixtures";

/**
 * **A claimed seat signs in its thread, and its door closes** (issue #2743,
 * ADR 20261105-waiver-folds-into-the-thread). An address a party's lead typed
 * gets a waiver-only door (`party_waiver_link`, issue #4003) because nobody
 * has shown it is the diver's. Claiming the seat hands it a thread link,
 * whose Sign step carries the release, so the door is a second link to a seat
 * the thread now carries. It opens nothing from the claim on, signs nothing,
 * and its rescue mails nothing. (Whether a claim proves the address is its
 * own question, filed separately.)
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
const DOOR = /\/waivers\/([A-Za-z0-9_-]+)/;

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

/** A public party whose member was mailed their door, before anyone claims the seat. */
async function memberWithDoor() {
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
  const token = mailTo(MEMBER)[0]?.match(DOOR)?.[1];
  if (!token) throw new Error("no door mailed");
  sesSend.mockClear();
  return { db, shop, lead, member, token };
}

async function claimAs(
  input: Awaited<ReturnType<typeof memberWithDoor>>,
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

describe("a party door after its seat is claimed (issue 2743)", () => {
  it("opens before the claim, and nothing after it", async () => {
    const party = await memberWithDoor();
    expect((await openOnDevice(party.db, party.token))?.door).toBe("counter");

    await claimAs(party);

    expect(await openOnDevice(party.db, party.token)).toBeNull();
  });

  it("is revoked by the claim, as every other link minted for the placeholder is", async () => {
    const party = await memberWithDoor();
    await claimAs(party);

    const doors = await party.db
      .select({ purpose: capabilities.purpose, revokedAt: capabilities.revokedAt })
      .from(capabilities)
      .where(eq(capabilities.shopId, party.shop.id));
    const partyDoors = doors.filter((row) => row.purpose === "party_waiver_link");
    expect(partyDoors.length).toBeGreaterThan(0);
    for (const door of partyDoors) expect(door.revokedAt).not.toBeNull();
  });

  it("closes a counter code minted for the placeholder too", async () => {
    const party = await memberWithDoor();
    const key = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });
    if (!key) throw new Error("no release on the seat");
    const counter = await mintCapability(party.db, {
      purpose: "waiver_link",
      shopId: party.shop.id,
      subjectId: key.recordId,
    });

    await claimAs(party);

    expect(await openOnDevice(party.db, counter.token)).toBeNull();
  });

  it("leaves the release itself on the seat, signable from the claimant's thread", async () => {
    const party = await memberWithDoor();
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
    // One mail: the claimant's confirmation, its Sign step on the thread link,
    // and no door.
    const mail = mailTo(MEMBER);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatch(/\/ready\/[\w.-]+\/waiver/);
    expect(mail[0]).not.toMatch(DOOR);
  });

  it("carries a fresh release as the Sign step when someone else claims the seat", async () => {
    const party = await memberWithDoor();
    const claimant = "ines.sign.2743@dive.day";
    await claimAs(party, { fullName: "Ines Vidal", email: claimant });

    const mail = mailTo(claimant);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatch(/\/ready\/[\w.-]+\/waiver/);
    expect(mail[0]).not.toMatch(DOOR);
    const key = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });
    if (!key) throw new Error("no release for the claimant");
    const [door] = await party.db
      .select({ recordId: capabilities.waiverRecordId })
      .from(capabilities)
      .where(eq(capabilities.purpose, "party_waiver_link"));
    expect(key.recordId).not.toBe(door?.recordId);
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

  it("refuses a door to a claimed seat even when nothing revoked it", async () => {
    // The read side holds the rule on its own: a seat stamped claimed by any
    // road is no longer an address the lead typed.
    const party = await memberWithDoor();
    const opened = await openOnDevice(party.db, party.token);
    if (opened?.door !== "counter") throw new Error("the door does not open");
    await party.db
      .update(bookings)
      .set({ claimedAt: nowDate() })
      .where(eq(bookings.id, party.member.bookingId));

    expect(await openOnDevice(party.db, party.token)).toBeNull();
    expect(
      await completeWaiver(party.db, opened.key, {
        signerName: "Theo Marsh",
        agreed: true,
        medicalAnswers: clearAnswers,
      }),
    ).toMatchObject({ ok: false });
  });

  it("is never rescued: the claimant's way on is their thread link", async () => {
    const party = await memberWithDoor();
    await claimAs(party);
    sesSend.mockClear();

    expect(await staleWaiverRecordForToken(party.db, party.token)).toBeNull();
    expect(await emailFreshWaiverLink(party.db, party.token)).toBe("unavailable");
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("names the shop for the page, and nothing else", async () => {
    const party = await memberWithDoor();
    expect(await claimedSeatDoor(party.db, party.token)).toBeNull();

    await claimAs(party);

    expect(await claimedSeatDoor(party.db, party.token)).toEqual({ shopId: party.shop.id });
  });

  it("names nothing for a garbage token, a counter code or a release link", async () => {
    const party = await memberWithDoor();
    const key = await threadWaiverKey(party.db, {
      shopId: party.shop.id,
      bookingId: party.member.bookingId,
    });
    if (!key) throw new Error("no release on the seat");
    const counter = await mintCapability(party.db, {
      purpose: "waiver_link",
      shopId: party.shop.id,
      subjectId: key.recordId,
    });
    await claimAs(party);

    expect(await claimedSeatDoor(party.db, "")).toBeNull();
    expect(await claimedSeatDoor(party.db, "not-a-token")).toBeNull();
    expect(await claimedSeatDoor(party.db, counter.token)).toBeNull();
  });

  it("closes the door when someone else claims the seat, and tells the displaced address nothing", async () => {
    const party = await memberWithDoor();
    await claimAs(party, { fullName: "Ines Vidal", email: "ines.2743@dive.day" });

    expect(await openOnDevice(party.db, party.token)).toBeNull();
    expect(await staleWaiverRecordForToken(party.db, party.token)).toBeNull();
    expect(await claimedSeatDoor(party.db, party.token)).toBeNull();
    expect(mailTo(MEMBER)).toEqual([]);
  });

  it("points no held claim at a Sign step it cannot open yet", async () => {
    const party = await memberWithDoor();
    // The member's address, a different name: the seat is held for the desk.
    await claimAs(party, { fullName: "T. Marsh-Ortega", email: MEMBER });

    expect(await openOnDevice(party.db, party.token)).toBeNull();
    expect(await claimedSeatDoor(party.db, party.token)).toBeNull();
    expect(mailTo(MEMBER).join("\n")).not.toMatch(/\/ready\/[\w.-]+\/waiver/);
  });

  it("still sends the confirmation when opening the Sign step fails", async () => {
    const party = await memberWithDoor();
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
