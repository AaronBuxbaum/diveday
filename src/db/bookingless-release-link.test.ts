import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, MINUTE_MS } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import type { NotificationProvider } from "@/lib/notifications";
import type { CourtesyProviders } from "@/lib/notifications/courtesy";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { mintCapability } from "./capabilities";
import { revokeLinksSentToOldContact } from "./contact-change";
import { activityEvents, capabilities, people, personRoles, waiverRecords } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { emailFreshWaiverLink, issueAndDeliverPersonWaiver } from "./waiver-issue";
import {
  completeWaiver,
  getWaiverForToken,
  hasLivePersonWaiverRequest,
  recordWaiverDraft,
  staleWaiverRecordForToken,
  waiverLinkDoor,
} from "./waivers";
import { openWaiverInThread } from "./waivers-requests";
import { openOnDevice, shopStaffer } from "./waivers-test-fixtures";

/**
 * **A release with no seat, and the two links that open it** (issue #3983).
 * Once signed it covers every seat the diver holds, so its link is bounded the
 * way a seat's is: Copy link is a counter link (half an hour, the first phone
 * only), and an email or a text carries a week's release link that goes only
 * to the contact on file and never comes back to staff.
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
const now = new Date("2026-07-18T12:00:00.000Z");

afterEach(() => vi.unstubAllEnvs());

async function diver(email: string | null = "unscheduled@dive.day") {
  const [person] = await ctx.db
    .insert(people)
    .values({
      shopId: ctx.shop.id,
      fullName: "Unscheduled Diver",
      email,
      phone: "+13055550188",
    })
    .returning();
  if (!person) throw new Error("person insert failed");
  return person;
}

function textCapture() {
  const bodies: string[] = [];
  const providers: CourtesyProviders = {
    whatsapp: null,
    sms: {
      send: vi.fn(async (message: { body: string }) => {
        bodies.push(message.body);
        return { status: "sent" as const, providerMessageId: `sms-${bodies.length}` };
      }),
    } as unknown as CourtesyProviders["sms"],
  };
  return { providers, bodies };
}

function emailCapture() {
  const urls: string[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      if (notification.kind === "waiver_request") urls.push(notification.completionUrl);
      return { status: "sent", providerMessageId: `ses-${urls.length}` };
    },
  };
  return { provider, urls };
}

function tokenIn(text: string | undefined): string {
  const match = text?.match(/\/waivers\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`no waiver link in ${text}`);
  return match[1];
}

const signature = (name: string) => ({
  signerName: name,
  agreed: true,
  medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
});

async function linksTo(recordId: string) {
  return ctx.db
    .select()
    .from(capabilities)
    .where(eq(capabilities.waiverRecordId, recordId))
    .orderBy(capabilities.issuedAt);
}

async function pendingRelease(personId: string) {
  const [record] = await ctx.db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.personId, personId),
        isNull(waiverRecords.bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    );
  if (!record) throw new Error("no pending release");
  return record;
}

describe("Copy link on a release with no seat", () => {
  it("mints a counter link: half an hour, the first phone only", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now,
    });
    expect(copied).toMatchObject({ ok: true, delivery: "link_only" });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");

    const record = await pendingRelease(person.id);
    const [link] = await linksTo(record.id);
    expect(link).toMatchObject({ purpose: "waiver_link", shopId: ctx.shop.id });
    expect(link?.expiresAt?.getTime()).toBe(now.getTime() + 30 * MINUTE_MS);

    // Not yet opened on any phone: it opens nothing until one claims it.
    expect(await waiverLinkDoor(ctx.db, copied.token, { now })).toEqual({
      door: "counter_unclaimed",
      via: "counter",
    });
    const door = await openOnDevice(ctx.db, copied.token, now);
    if (door?.door !== "counter") throw new Error(`counter door expected, got ${door?.door}`);
    expect(door.key).toMatchObject({ bookingId: null, recordId: record.id });
    // A second phone holding the same URL is turned away.
    expect(await waiverLinkDoor(ctx.db, copied.token, { device: "another-phone", now })).toEqual({
      door: "counter_elsewhere",
      via: "counter",
    });

    expect(await completeWaiver(ctx.db, door.key, { ...signature(person.fullName), now })).toEqual({
      ok: true,
      status: "completed",
      idempotent: false,
    });
    const [spent] = await linksTo(record.id);
    expect(spent?.usedAt).not.toBeNull();
  });

  it("opens nothing after its half hour, and leaves no expired release behind", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now,
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    const door = await openOnDevice(ctx.db, copied.token, now);
    if (door?.door !== "counter") throw new Error("counter door expected");
    const later = new Date(now.getTime() + 31 * MINUTE_MS);
    expect(await waiverLinkDoor(ctx.db, copied.token, { now: later })).toBeNull();
    // The key made inside the half hour signs nothing after it.
    expect(
      await completeWaiver(ctx.db, door.key, { ...signature(person.fullName), now: later }),
    ).toEqual({ ok: false, reason: "unavailable" });
    // The release itself has no clock of its own: it waits for the next link.
    expect((await getWaiverForToken(ctx.db, door.key, now)).state).toBe("available");
  });
});

describe("who took a copied link", () => {
  it("writes the staffer on the diver's trail, and refuses a Copy link that names nobody", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, { channel: "link", now }),
    ).toMatchObject({ ok: false, reason: "error" });
    expect(await linksTo((await pendingRelease(person.id)).id)).toHaveLength(0);

    const staffer = await shopStaffer(ctx.db, ctx.shop.id);
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: staffer,
      now,
    });
    expect(copied).toMatchObject({ ok: true, delivery: "link_only" });
    const trail = await ctx.db
      .select({ actor: activityEvents.actorPersonId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.subjectPersonId, person.id),
          eq(activityEvents.code, "waiver_link_copied"),
        ),
      );
    expect(trail).toEqual([{ actor: staffer }]);
  });

  it("never prefills medical answers saved through another link", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now,
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    const counter = await openOnDevice(ctx.db, copied.token, now);
    if (counter?.door !== "counter") throw new Error("counter door expected");
    await recordWaiverDraft(ctx.db, counter.key, {
      acknowledged: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now,
    });
    const { providers, bodies } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const door = await waiverLinkDoor(ctx.db, tokenIn(bodies[0]), { now });
    if (door?.door !== "release") throw new Error("release door expected");
    const record = await pendingRelease(person.id);
    // The draft is the counter phone's, so the page will not prefill it here.
    expect(record.draftViaLinkId).toBe(counter.key.linkId);
    expect(record.draftViaLinkId).not.toBe(door.key.linkId);
  });
});

describe("Email and text on a release with no seat", () => {
  it("carry a week's release link that is never handed back to staff", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { provider, urls } = emailCapture();
    const sent = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "email",
      provider,
      now,
    });
    expect(sent).toMatchObject({ ok: true, delivery: "sent", token: null });
    const token = tokenIn(urls[0]);

    const record = await pendingRelease(person.id);
    const [link] = await linksTo(record.id);
    expect(link).toMatchObject({ purpose: "release_link", claimHash: null, usedAt: null });
    expect(link?.expiresAt?.getTime()).toBe(now.getTime() + 7 * DAY_MS);

    // No phone claims it: it opens wherever its owner opens the mail.
    const door = await waiverLinkDoor(ctx.db, token, { now });
    if (door?.door !== "release") throw new Error(`release door expected, got ${door?.door}`);
    expect(door.key).toMatchObject({ kind: "release", recordId: record.id });
    expect(await completeWaiver(ctx.db, door.key, { ...signature(person.fullName), now })).toEqual({
      ok: true,
      status: "completed",
      idempotent: false,
    });
    const [spent] = await linksTo(record.id);
    expect(spent?.usedAt).not.toBeNull();
    // The spent link still opens its own receipt, and nothing else.
    const receipt = await waiverLinkDoor(ctx.db, token, { now });
    if (receipt?.door !== "release") throw new Error("receipt expected");
    expect((await getWaiverForToken(ctx.db, receipt.key, now)).state).toBe("completed");
  });

  it("hands nothing back when the send fails, or when it is a text", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const failing: NotificationProvider = {
      async send() {
        return { status: "failed", errorCode: "rejected" };
      },
    };
    const failed = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "email",
      provider: failing,
      now,
    });
    expect(failed).toMatchObject({ ok: true, delivery: "failed", token: null });
    // A link that reached nobody is withdrawn, so it never blocks the rescue.
    expect(await hasLivePersonWaiverRequest(ctx.db, ctx.shop.id, person.id, now)).toBe(false);

    const { providers, bodies } = textCapture();
    const texted = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    expect(texted).toMatchObject({ ok: true, delivery: "sent", token: null });
    expect((await waiverLinkDoor(ctx.db, tokenIn(bodies[0]), { now }))?.door).toBe("release");
  });

  it("keeps one live link per release: a resend or a Copy link retires the one before", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { providers, bodies } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const [first, second] = [tokenIn(bodies[0]), tokenIn(bodies[1])];
    expect(first).not.toBe(second);
    expect(await waiverLinkDoor(ctx.db, first, { now })).toBeNull();
    expect((await waiverLinkDoor(ctx.db, second, { now }))?.door).toBe("release");

    // The draft survives: both links named the same release.
    const record = await pendingRelease(person.id);
    expect((await linksTo(record.id)).map((link) => link.purpose)).toEqual([
      "release_link",
      "release_link",
    ]);

    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now,
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    expect(await waiverLinkDoor(ctx.db, second, { now })).toBeNull();
    expect(await pendingRelease(person.id)).toMatchObject({ id: record.id });
  });
});

describe("what a release link never opens", () => {
  it("a release link that names a seat's release opens nothing", async () => {
    const trips = await upcomingTripsWithCounts(ctx.db, ctx.shop.id, new Date(0));
    const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
    if (!trip) throw new Error("demo trip missing");
    const [seat] = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    if (!seat) throw new Error("demo seat missing");
    const opened = await openWaiverInThread(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: seat.booking.id,
      expectedPersonId: seat.person.id,
      expectedTripId: trip.id,
      now,
    });
    if (!opened.ok) throw new Error(`thread release refused: ${opened.reason}`);
    const forged = await mintCapability(ctx.db, {
      purpose: "release_link",
      shopId: ctx.shop.id,
      subjectId: opened.recordId,
      now,
    });
    expect(await waiverLinkDoor(ctx.db, forged.token, { now })).toBeNull();
    expect(await staleWaiverRecordForToken(ctx.db, forged.token, now)).toBeNull();
  });

  it("a release link of one purpose never verifies as the other", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now,
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    // Unclaimed, the counter link is not a release link by another name.
    expect(await waiverLinkDoor(ctx.db, copied.token, { now })).toEqual({
      door: "counter_unclaimed",
      via: "counter",
    });
    expect(await staleWaiverRecordForToken(ctx.db, copied.token, now)).toBeNull();
  });

  it("a party member's door that names a release with no seat opens nothing", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { providers } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const record = await pendingRelease(person.id);
    // Signed, this release covers every seat the diver holds; the join email's
    // door is for one seat's release only (issue #3986).
    const forged = await mintCapability(ctx.db, {
      purpose: "party_waiver_link",
      shopId: ctx.shop.id,
      subjectId: record.id,
      now,
    });
    expect(await waiverLinkDoor(ctx.db, forged.token, { now })).toBeNull();
    expect(await openOnDevice(ctx.db, forged.token, now)).toBeNull();
    expect(await staleWaiverRecordForToken(ctx.db, forged.token, now)).toBeNull();
  });
});

describe("one live door per release, whatever its purpose", () => {
  it("a counter link, a party member's door and a release link each revoke the others", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { providers } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const record = await pendingRelease(person.id);
    const order = [
      "waiver_link",
      "party_waiver_link",
      "release_link",
      "party_waiver_link",
      "waiver_link",
      "release_link",
    ] as const;
    for (const purpose of order) {
      const minted = await mintCapability(ctx.db, {
        purpose,
        shopId: ctx.shop.id,
        subjectId: record.id,
        now,
      });
      const live = (await linksTo(record.id)).filter((link) => link.revokedAt === null);
      expect(live.map((link) => link.id)).toEqual([minted.id]);
    }
  });
});

describe("a corrected contact and an erasure", () => {
  it("a contact change closes the live link, and the receipt of a signed one", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { providers, bodies } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const live = tokenIn(bodies[0]);
    await revokeLinksSentToOldContact(ctx.db, { shopId: ctx.shop.id, personId: person.id, now });
    expect(await waiverLinkDoor(ctx.db, live, { now })).toBeNull();
    expect(await hasLivePersonWaiverRequest(ctx.db, ctx.shop.id, person.id, now)).toBe(false);

    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const fresh = tokenIn(bodies[1]);
    const door = await waiverLinkDoor(ctx.db, fresh, { now });
    if (door?.door !== "release") throw new Error("release door expected");
    await completeWaiver(ctx.db, door.key, { ...signature(person.fullName), now });
    expect((await waiverLinkDoor(ctx.db, fresh, { now }))?.door).toBe("release");
    await revokeLinksSentToOldContact(ctx.db, { shopId: ctx.shop.id, personId: person.id, now });
    expect(await waiverLinkDoor(ctx.db, fresh, { now })).toBeNull();
  });

  it("an erasure deletes every link to the person's releases", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { providers } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const record = await pendingRelease(person.id);
    expect(await linksTo(record.id)).toHaveLength(1);
    const [owner] = await ctx.db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("owner missing");
    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: person.id,
      actorPersonId: owner.personId,
    });
    expect(erased).toMatchObject({ ok: true });
    expect(await linksTo(record.id)).toHaveLength(0);
  });
});

describe("a dead release link", () => {
  it("lands on the rescue, which mails a fresh one to the address on file only", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const person = await diver();
    const { provider, urls } = emailCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "email",
      provider,
      now,
    });
    const old = tokenIn(urls[0]);
    expect(await hasLivePersonWaiverRequest(ctx.db, ctx.shop.id, person.id, now)).toBe(true);

    const later = new Date(now.getTime() + 8 * DAY_MS);
    expect(await waiverLinkDoor(ctx.db, old, { now: later })).toBeNull();
    expect(await hasLivePersonWaiverRequest(ctx.db, ctx.shop.id, person.id, later)).toBe(false);
    const stale = await staleWaiverRecordForToken(ctx.db, old, later);
    expect(stale).toMatchObject({ personId: person.id, bookingId: null });

    // A live counter link counts as a live request too.
    const copied = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
      now: later,
    });
    if (!copied.ok) throw new Error("copy link refused");
    expect(await hasLivePersonWaiverRequest(ctx.db, ctx.shop.id, person.id, later)).toBe(true);
    expect(await emailFreshWaiverLink(ctx.db, old, later)).toBe("current_link_live");
  });

  it("a rescue issues a fresh release link and keeps the dead URL on the rescue card", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "rescue" });
    const person = await diver();
    const { provider, urls } = emailCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, person.id, {
      channel: "email",
      provider,
      now,
    });
    const old = tokenIn(urls[0]);
    const later = new Date(now.getTime() + 8 * DAY_MS);
    expect(await emailFreshWaiverLink(ctx.db, old, later)).toBe("sent");
    const record = await pendingRelease(person.id);
    const links = await linksTo(record.id);
    expect(links.map((link) => [link.purpose, link.revokedAt === null])).toEqual([
      ["release_link", false],
      ["release_link", true],
    ]);
    // The fresh link went to the address on file; the dead URL still lands on
    // the rescue card, which now says a newer link is live.
    expect(await staleWaiverRecordForToken(ctx.db, old, later)).toMatchObject({ id: record.id });
    expect(await emailFreshWaiverLink(ctx.db, old, later)).toBe("current_link_live");
  });
});
