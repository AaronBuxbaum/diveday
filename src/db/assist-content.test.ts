import { and, asc, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CERT_SCAN_FEATURE, certScanCall, certScanFields, scanCard } from "@/lib/assists/cert-scan";
import { sourceDigest } from "@/lib/assists/shop-translate";
import type { ClaudeProvider } from "@/lib/claude/provider";
import type { WeeklyDigestEmailSection } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { readAssistResults } from "./assist-results";
import { runAssist } from "./assists";
import { readUnsurePair } from "./desk-assists";
import { deleteDiveSite } from "./dive-sites";
import { mondayReadFor } from "./monday-read";
import { autoFillRecapLine, draftRecapLine, recapLogFor } from "./recap-assist";
import {
  flagWaitingReviews,
  readReviewFlags,
  readReviewThemes,
  refreshReviewThemes,
  themesMonth,
} from "./review-assists";
import {
  assistResults,
  certifications,
  diveSites,
  incidentReports,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripReviews,
  tripSightings,
  trips,
} from "./schema";
import { readTranslations, saveTranslation, translatedOr } from "./shop-text-translations";
import { liveTrip } from "./trips-live";

const ctx = fileScopedShopContext({ history: true });
const env = { ANTHROPIC_API_KEY: "test-anthropic-key" };
const now = new Date("2026-10-19T12:00:00.000Z");

// The seeded shop is a demo, and demos are dark; these are about a real shop.
beforeEach(async () => {
  await ctx.db
    .update(shops)
    .set({ isDemo: false, claudeSuggestionsEnabled: true, sightingsEnabled: true })
    .where(eq(shops.id, ctx.shop.id));
});

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

/** A provider that refuses every call: an answer, so asking again costs the same for the same refusal. */
function refusing() {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: "", stopReason: "refusal" }) });
}

/** A provider whose every call fails before answering: nothing was answered, so a later pass asks again. */
function failing() {
  return fakeClaude({
    reply: () => {
      throw new Error("provider down");
    },
  });
}

describe("the Monday read", () => {
  const sections = [
    { kind: "waivers", divers: 3, departures: 2, url: "https://diveday.test/shop/x/waivers" },
  ] as unknown as WeeklyDigestEmailSection[];
  const input = () => ({
    shopId: ctx.shop.id,
    weekOf: "2026-10-19",
    grade: "reports",
    locale: "en-US",
    sections,
  });

  it("asks once a week per grade and language, and fills only that section's numbers", async () => {
    const provider = answering({
      sentences: [{ section: "waivers", text: "{waivers.divers} divers still owe a waiver." }],
    });
    const first = await mondayReadFor(ctx.db, input(), { provider, env, now });
    const second = await mondayReadFor(ctx.db, input(), { provider, env, now });
    expect(first).toEqual([{ section: "waivers", text: "3 divers still owe a waiver." }]);
    expect(second).toEqual(first);
    expect(provider.requests).toHaveLength(1);
    // Only the counts go out: no link, no shop name.
    expect(JSON.stringify(provider.requests[0]?.messages)).not.toContain("diveday.test");
  });

  it("remembers a refused read, so the hourly pass does not ask again", async () => {
    const provider = refusing();
    expect(await mondayReadFor(ctx.db, input(), { provider, env, now })).toEqual([]);
    expect(await mondayReadFor(ctx.db, input(), { provider, env, now })).toEqual([]);
    expect(provider.requests).toHaveLength(1);
  });

  it("asks again when the call never answered", async () => {
    const provider = failing();
    await mondayReadFor(ctx.db, input(), { provider, env, now });
    await mondayReadFor(ctx.db, input(), { provider, env, now });
    expect(provider.requests.length).toBeGreaterThanOrEqual(2);
  });

  it("says nothing and stores nothing while the shop is dark", async () => {
    await ctx.db
      .update(shops)
      .set({ claudeSuggestionsEnabled: false })
      .where(eq(shops.id, ctx.shop.id));
    const provider = answering({ sentences: [{ section: "waivers", text: "Hi." }] });
    expect(await mondayReadFor(ctx.db, input(), { provider, env, now })).toEqual([]);
    expect(provider.requests).toHaveLength(0);
    const stored = await ctx.db
      .select()
      .from(assistResults)
      .where(eq(assistResults.shopId, ctx.shop.id));
    expect(stored).toHaveLength(0);
  });
});

async function seededReviews(count: number) {
  const rows = await ctx.db
    .select({ id: tripReviews.id })
    .from(tripReviews)
    .where(eq(tripReviews.shopId, ctx.shop.id))
    .orderBy(desc(tripReviews.id))
    .limit(count);
  expect(rows.length).toBe(count);
  return rows.map((row) => row.id);
}

describe("review flags", () => {
  it("stores each waiting comment's flags and drops them once the comment changes", async () => {
    const [a, b] = await seededReviews(2);
    if (!a || !b) throw new Error("seed has no reviews");
    const waiting = [
      { id: a, comment: "The divemaster Ana left us at depth." },
      { id: b, comment: "Lovely day, call me on 555 123 4567" },
    ];
    const provider = answering({ flags: ["names_someone", "safety_complaint"] });
    expect(await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now })).toBe(2);
    expect(await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now })).toBe(0);
    const flags = await readReviewFlags(ctx.db, ctx.shop.id, waiting);
    expect(flags.get(a)).toEqual(["names_someone", "safety_complaint"]);
    expect(flags.get(b)).toContain("contact_info");

    const edited = await readReviewFlags(ctx.db, ctx.shop.id, [{ id: a, comment: "Great dive." }]);
    expect(edited.get(a)).toBeUndefined();
  });
});

describe("review flags after a refusal", () => {
  it("remembers a refused comment and reads the ones behind it", async () => {
    const [a, b] = await seededReviews(2);
    if (!a || !b) throw new Error("seed has no reviews");
    const waiting = [
      { id: a, comment: "Words the model will not read." },
      { id: b, comment: "The divemaster Ana left us at depth." },
    ];
    const provider = fakeClaude({
      reply: (request) =>
        JSON.stringify(request.messages).includes("will not read")
          ? fakeClaudeMessage({ text: "", stopReason: "refusal" })
          : fakeClaudeMessage({ text: JSON.stringify({ flags: ["safety_complaint"] }) }),
    });
    expect(await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now })).toBe(2);
    expect((await readReviewFlags(ctx.db, ctx.shop.id, waiting)).get(b)).toEqual([
      "safety_complaint",
    ]);
    // The next visit asks about neither.
    expect(await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now })).toBe(0);
    expect(provider.requests).toHaveLength(2);
  });

  it("stores nothing for a call that never answered, so the next visit asks again", async () => {
    const [a] = await seededReviews(1);
    if (!a) throw new Error("seed has no reviews");
    const waiting = [{ id: a, comment: "Lovely day." }];
    const provider = failing();
    expect(await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now })).toBe(0);
    const before = provider.requests.length;
    await flagWaitingReviews(ctx.db, ctx.shop.id, waiting, { provider, env, now });
    expect(provider.requests.length).toBeGreaterThan(before);
  });
});

describe("review themes", () => {
  it("keeps one set a month, quoting the reviews as they stand now", async () => {
    const ids = await seededReviews(6);
    for (const [index, id] of ids.entries()) {
      await ctx.db
        .update(tripReviews)
        .set({ isPublished: true, publishedAt: now, comment: `Review words ${index}` })
        .where(eq(tripReviews.id, id));
    }
    const provider = fakeClaude({
      reply: (request) => {
        const sent = [...JSON.stringify(request.messages).matchAll(/\\"(r\d+)\\"/g)].map(
          (m) => m[1],
        );
        return fakeClaudeMessage({
          text: JSON.stringify({
            themes: [
              { title: "Briefings", reviewIds: sent.slice(0, 2) },
              { title: "The boat", reviewIds: sent.slice(2, 4) },
              { title: "Turtles", reviewIds: [...sent.slice(4, 5), "r999"] },
              { title: "Made up", reviewIds: ["r998", "r997"] },
            ],
          }),
        });
      },
    });
    expect(
      await refreshReviewThemes(ctx.db, ctx.shop.id, "en-US", now, { provider, env, now }),
    ).toBe(true);
    expect(
      await refreshReviewThemes(ctx.db, ctx.shop.id, "en-US", now, { provider, env, now }),
    ).toBe(false);
    expect(provider.requests).toHaveLength(1);

    // Two themes kept two real ids each; the rest had fewer than two.
    // Fewer than three themes is no themes at all.
    expect(await readReviewThemes(ctx.db, ctx.shop.id, now)).toEqual([]);
    const stored = await readAssistResults(ctx.db, ctx.shop.id, "review_themes", [
      themesMonth(now),
    ]);
    expect(stored.size).toBe(1);
  });

  it("remembers a refused month, so each visit does not ask again", async () => {
    const ids = await seededReviews(6);
    for (const [index, id] of ids.entries()) {
      await ctx.db
        .update(tripReviews)
        .set({ isPublished: true, publishedAt: now, comment: `Refused words ${index}` })
        .where(eq(tripReviews.id, id));
    }
    const provider = refusing();
    await refreshReviewThemes(ctx.db, ctx.shop.id, "en-US", now, { provider, env, now });
    await refreshReviewThemes(ctx.db, ctx.shop.id, "en-US", now, { provider, env, now });
    expect(provider.requests).toHaveLength(1);
    expect(await readReviewThemes(ctx.db, ctx.shop.id, now)).toEqual([]);
  });

  it("drops a theme whose quotes were unpublished since", async () => {
    const ids = await seededReviews(6);
    for (const [index, id] of ids.entries()) {
      await ctx.db
        .update(tripReviews)
        .set({ isPublished: true, publishedAt: now, comment: `Words ${index}` })
        .where(eq(tripReviews.id, id));
    }
    const provider = fakeClaude({
      reply: (request) => {
        const sent = [...JSON.stringify(request.messages).matchAll(/\\"(r\d+)\\"/g)].map(
          (m) => m[1],
        );
        return fakeClaudeMessage({
          text: JSON.stringify({
            themes: [
              { title: "Briefings", reviewIds: sent.slice(0, 2) },
              { title: "The boat", reviewIds: sent.slice(2, 4) },
              { title: "Turtles", reviewIds: sent.slice(4, 6) },
            ],
          }),
        });
      },
    });
    await refreshReviewThemes(ctx.db, ctx.shop.id, "en-US", now, { provider, env, now });
    expect(
      (await readReviewThemes(ctx.db, ctx.shop.id, now)).map((theme) => theme.title),
    ).toHaveLength(3);
    const first = (await readReviewThemes(ctx.db, ctx.shop.id, now))[0];
    const quoted = first?.quotes[0]?.id;
    if (!quoted) throw new Error("no quote");
    await ctx.db.update(tripReviews).set({ isPublished: false }).where(eq(tripReviews.id, quoted));
    const after = await readReviewThemes(ctx.db, ctx.shop.id, now);
    expect(after).toHaveLength(2);
    expect(JSON.stringify(after)).not.toContain(quoted);
  });
});

describe("shop text translations", () => {
  async function tripSubject() {
    const [trip] = await ctx.db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, ctx.shop.id))
      .limit(1);
    if (!trip) throw new Error("seed has no trips");
    return { kind: "trip", id: trip.id, field: "description" } as const;
  }

  it("reads the Spanish while the original is the one translated", async () => {
    const subject = await tripSubject();
    const original = "Two tanks on the wall, 18 m max.";
    expect(
      await saveTranslation(ctx.db, ctx.shop.id, subject, {
        text: "Dos tanques en la pared, 18 m máx.",
        original,
        translatedFrom: "",
      }),
    ).toBe("saved");
    const map = await readTranslations(ctx.db, ctx.shop.id, "trip", [subject.id]);
    expect(translatedOr(map, subject.id, "description", original)).toBe(
      "Dos tanques en la pared, 18 m máx.",
    );
    expect(translatedOr(map, subject.id, "description", "Two tanks, 30 m max.")).toBe(
      "Two tanks, 30 m max.",
    );
    expect(
      await saveTranslation(
        ctx.db,
        ctx.shop.id,
        { ...subject, field: "title" },
        { text: "x", original, translatedFrom: "" },
      ),
    ).toBe("refused");
  });

  it("never re-pins old Spanish to an original that changed under it", async () => {
    const subject = await tripSubject();
    const before = "Easy reef along the sand edge.";
    const spanish = "Arrecife fácil junto al borde de arena.";
    await saveTranslation(ctx.db, ctx.shop.id, subject, {
      text: spanish,
      original: before,
      translatedFrom: sourceDigest(before),
    });
    const after =
      "Easy reef along the sand edge. Strong down-current past the point on the outgoing tide: turn back at the mooring.";
    // Save Spanish pressed with the box as it was: what it holds translated `before`.
    expect(
      await saveTranslation(ctx.db, ctx.shop.id, subject, {
        text: spanish,
        original: after,
        translatedFrom: sourceDigest(before),
      }),
    ).toBe("stale");
    const map = await readTranslations(ctx.db, ctx.shop.id, "trip", [subject.id]);
    expect(translatedOr(map, subject.id, "description", after)).toBe(after);
    // A draft of the English that was never saved: the same refusal.
    expect(
      await saveTranslation(ctx.db, ctx.shop.id, subject, {
        text: "Un arrecife.",
        original: after,
        translatedFrom: sourceDigest("A reef."),
      }),
    ).toBe("stale");
    // Spanish drafted from the current original, or rewritten by hand, saves.
    expect(
      await saveTranslation(ctx.db, ctx.shop.id, subject, {
        text: "Arrecife junto a la arena. Fuerte corriente descendente: regresa en la boya.",
        original: after,
        translatedFrom: "",
      }),
    ).toBe("saved");
    expect(
      await saveTranslation(ctx.db, ctx.shop.id, subject, {
        text: "",
        original: after,
        translatedFrom: sourceDigest(before),
      }),
    ).toBe("saved");
  });
});

describe("a translation's subject going", () => {
  it("takes its Spanish with it when a dive site is deleted", async () => {
    const [site] = await ctx.db
      .insert(diveSites)
      .values({ shopId: ctx.shop.id, name: "Translation Reef", slug: "translation-reef" })
      .returning({ id: diveSites.id });
    if (!site) throw new Error("site was not inserted");
    const subject = { kind: "dive_site", id: site.id, field: "description" } as const;
    await saveTranslation(ctx.db, ctx.shop.id, subject, {
      text: "Un arrecife.",
      original: "A reef.",
      translatedFrom: "",
    });
    expect((await readTranslations(ctx.db, ctx.shop.id, "dive_site", [site.id])).size).toBe(1);
    expect(await deleteDiveSite(ctx.db, ctx.shop.id, site.id)).toBe(true);
    expect((await readTranslations(ctx.db, ctx.shop.id, "dive_site", [site.id])).size).toBe(0);
  });
});

describe("the recap highlight", () => {
  async function tripWithSightings(slugs: readonly string[]) {
    const [trip] = await ctx.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, ctx.shop.id), liveTrip()))
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(1);
    const [site] = await ctx.db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, ctx.shop.id))
      .limit(1);
    const [person] = await ctx.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, ctx.shop.id))
      .limit(1);
    if (!trip || !site || !person) throw new Error("seed is missing a trip, a site or a person");
    await ctx.db
      .update(trips)
      .set({ recapShoutout: null, waterTemperatureC: 26 })
      .where(eq(trips.id, trip.id));
    await ctx.db.delete(tripSightings).where(eq(tripSightings.tripId, trip.id));
    for (const slug of slugs) {
      await ctx.db.insert(tripSightings).values({
        shopId: ctx.shop.id,
        tripId: trip.id,
        diveSiteId: site.id,
        diveSiteName: site.name,
        speciesSlug: slug,
        count: 2,
        recordedByPersonId: person.id,
      });
    }
    return { tripId: trip.id, site: site.name, personId: person.id };
  }

  it("names only what the crew logged, in the shop's words", async () => {
    const { tripId, site } = await tripWithSightings(["green-sea-turtle"]);
    const log = await recapLogFor(ctx.db, ctx.shop.id, tripId);
    expect(log?.sites).toEqual([
      {
        name: site,
        species: [expect.objectContaining({ slug: "green-sea-turtle", count: 2 })],
      },
    ]);
    expect(log?.conditions.waterTemp).toMatch(/°/);

    const fine = answering({
      text: "{count:1:green-sea-turtle} {species:1:green-sea-turtle} at {site1}.",
    });
    expect(await draftRecapLine(ctx.db, ctx.shop.id, tripId, { provider: fine, env, now })).toMatch(
      /^2 green sea turtle at /i,
    );
    const invented = answering({
      text: "{species:1:green-sea-turtle} and a whale shark at {site1}.",
    });
    expect(
      await draftRecapLine(ctx.db, ctx.shop.id, tripId, { provider: invented, env, now }),
    ).toBeNull();
  });

  it("fills a blank highlight only when the shop said so, and never over the crew's", async () => {
    const { tripId } = await tripWithSightings(["green-sea-turtle"]);
    const provider = answering({ text: "{species:1:green-sea-turtle} at {site1}." });
    const trip = { id: tripId, shopId: ctx.shop.id, recapShoutout: null };
    expect(
      await autoFillRecapLine(
        ctx.db,
        trip,
        { recapAssistAutoApprove: false },
        { provider, env, now },
      ),
    ).toBe(false);
    expect(provider.requests).toHaveLength(0);
    expect(
      await autoFillRecapLine(
        ctx.db,
        trip,
        { recapAssistAutoApprove: true },
        { provider, env, now },
      ),
    ).toBe(true);
    const [row] = await ctx.db
      .select({ line: trips.recapShoutout })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(row?.line).toMatch(/turtle/i);
    // The crew's own words stay.
    expect(
      await autoFillRecapLine(
        ctx.db,
        { ...trip, recapShoutout: "Best day of the year." },
        { recapAssistAutoApprove: true },
        { provider, env, now },
      ),
    ).toBe(false);
  });

  it("remembers a refused line, so the next send pass does not ask again", async () => {
    const { tripId } = await tripWithSightings(["green-sea-turtle"]);
    const provider = refusing();
    const trip = { id: tripId, shopId: ctx.shop.id, recapShoutout: null };
    const shop = { recapAssistAutoApprove: true };
    expect(await autoFillRecapLine(ctx.db, trip, shop, { provider, env, now })).toBe(false);
    expect(await autoFillRecapLine(ctx.db, trip, shop, { provider, env, now })).toBe(false);
    expect(provider.requests).toHaveLength(1);
    // A staffer's own tap still asks.
    await draftRecapLine(ctx.db, ctx.shop.id, tripId, { provider, env, now });
    expect(provider.requests).toHaveLength(2);
  });

  it("asks again on the next pass when the call never answered", async () => {
    const { tripId } = await tripWithSightings(["green-sea-turtle"]);
    const provider = failing();
    const trip = { id: tripId, shopId: ctx.shop.id, recapShoutout: null };
    const shop = { recapAssistAutoApprove: true };
    await autoFillRecapLine(ctx.db, trip, shop, { provider, env, now });
    const before = provider.requests.length;
    await autoFillRecapLine(ctx.db, trip, shop, { provider, env, now });
    expect(provider.requests.length).toBeGreaterThan(before);
  });

  it("writes no line by itself on a departure with an incident report", async () => {
    const { tripId, personId } = await tripWithSightings(["green-sea-turtle"]);
    await ctx.db
      .insert(incidentReports)
      .values({ shopId: ctx.shop.id, tripId, createdByPersonId: personId });
    const provider = answering({ text: "{species:1:green-sea-turtle} at {site1}." });
    expect(
      await autoFillRecapLine(
        ctx.db,
        { id: tripId, shopId: ctx.shop.id, recapShoutout: null },
        { recapAssistAutoApprove: true },
        { provider, env, now },
      ),
    ).toBe(false);
    expect(provider.requests).toHaveLength(0);
    const [row] = await ctx.db
      .select({ line: trips.recapShoutout })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(row?.line).toBeNull();
    // The crew can still draft one and read it first.
    expect(await draftRecapLine(ctx.db, ctx.shop.id, tripId, { provider, env, now })).toMatch(
      /turtle/i,
    );
    await ctx.db.delete(incidentReports).where(eq(incidentReports.tripId, tripId));
  });

  it("writes no line when an incident report is filed while Claude is answering", async () => {
    const { tripId, personId } = await tripWithSightings(["green-sea-turtle"]);
    // The check before the call passes; the report lands during the call.
    const provider: ClaudeProvider = {
      async createMessage() {
        await ctx.db
          .insert(incidentReports)
          .values({ shopId: ctx.shop.id, tripId, createdByPersonId: personId });
        return fakeClaudeMessage({
          text: JSON.stringify({ text: "{species:1:green-sea-turtle} at {site1}." }),
        });
      },
    };
    expect(
      await autoFillRecapLine(
        ctx.db,
        { id: tripId, shopId: ctx.shop.id, recapShoutout: null },
        { recapAssistAutoApprove: true },
        { provider, env, now },
      ),
    ).toBe(false);
    const [row] = await ctx.db
      .select({ line: trips.recapShoutout })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(row?.line).toBeNull();
    await ctx.db.delete(incidentReports).where(eq(incidentReports.tripId, tripId));
  });

  it("has nothing to write from while the shop has sightings switched off", async () => {
    const { tripId } = await tripWithSightings(["green-sea-turtle"]);
    await ctx.db.update(shops).set({ sightingsEnabled: false }).where(eq(shops.id, ctx.shop.id));
    try {
      expect(await recapLogFor(ctx.db, ctx.shop.id, tripId)).toBeNull();
    } finally {
      await ctx.db.update(shops).set({ sightingsEnabled: true }).where(eq(shops.id, ctx.shop.id));
    }
  });

  it("has nothing to say about a departure with no sightings", async () => {
    const { tripId } = await tripWithSightings([]);
    expect(await recapLogFor(ctx.db, ctx.shop.id, tripId)).toBeNull();
  });
});

describe("the same-person read", () => {
  it("sends only a pair's live, verified cards", async () => {
    const [a, b] = await ctx.db
      .insert(people)
      .values([
        { shopId: ctx.shop.id, fullName: "Rosa Quintero Assist", email: "rosa.a@example.test" },
        { shopId: ctx.shop.id, fullName: "Rosa Quintero Assist", email: "rq.b@example.test" },
      ])
      .returning({ id: people.id });
    if (!a || !b) throw new Error("people were not inserted");
    await ctx.db.insert(certifications).values([
      // A card removed as wrong, and a claim nobody checked: neither is a level held.
      {
        shopId: ctx.shop.id,
        personId: a.id,
        agency: "padi",
        level: "divemaster",
        identifier: "DM-1",
        status: "verified",
        deletedAt: now,
      },
      { shopId: ctx.shop.id, personId: a.id, agency: "padi", level: "rescue", identifier: "R-1" },
      {
        shopId: ctx.shop.id,
        personId: b.id,
        agency: "padi",
        level: "open_water",
        identifier: "OW-1",
        status: "verified",
      },
    ]);
    const pair = await readUnsurePair(ctx.db, ctx.shop.id, a.id, b.id);
    expect(pair?.[0].certifications).toEqual([]);
    expect(pair?.[1].certifications).toEqual(["open_water"]);
  });
});

describe("the card photo read", () => {
  const image = { data: "aGVsbG8=", mediaType: "image/jpeg" as const };
  const options = {
    agencies: ["padi", "ssi"] as const,
    cards: [["level:open_water", "Open Water"]] as const,
  };

  async function cardRows() {
    const [levels, specialties, nitrox] = await Promise.all([
      ctx.db.select({ id: certifications.id }).from(certifications),
      ctx.db.select({ id: specialtyCertifications.id }).from(specialtyCertifications),
      ctx.db.select({ id: nitroxCertifications.id }).from(nitroxCertifications),
    ]);
    return levels.length + specialties.length + nitrox.length;
  }

  it("answers form values only, writes no card, and reads a doubtful photo as nothing", async () => {
    const before = await cardRows();
    const read = (confidence: number) =>
      fakeClaude({
        reply: () =>
          fakeClaudeMessage({
            text: JSON.stringify({
              agency: "padi",
              card: "level:open_water",
              cardNumber: "PADI 1234567",
              confidence,
            }),
          }),
      });
    const sure = read(0.95);
    const value = await scanCard((model) =>
      runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: CERT_SCAN_FEATURE,
        call: certScanCall(image, options, model),
        provider: sure,
        env,
        now,
      }),
    );
    expect(certScanFields(value)).toEqual({
      agency: "padi",
      card: "level:open_water",
      cardNumber: "PADI 1234567",
    });

    const doubtful = read(0.3);
    const none = await scanCard((model) =>
      runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: CERT_SCAN_FEATURE,
        call: certScanCall(image, options, model),
        provider: doubtful,
        env,
        now,
      }),
    );
    expect(certScanFields(none)).toEqual({});
    // Haiku, then Sonnet once, then nothing.
    expect(doubtful.requests).toHaveLength(2);
    expect(await cardRows()).toBe(before);

    // A photo Haiku says is not a card is never sent to Sonnet: each anonymous
    // junk image costs one call, not two (security review L3, B2).
    const notACard = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({ agency: null, card: null, cardNumber: null, confidence: 0 }),
        }),
    });
    const nothing = await scanCard((model) =>
      runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: CERT_SCAN_FEATURE,
        call: certScanCall(image, options, model),
        provider: notACard,
        env,
        now,
      }),
    );
    expect(certScanFields(nothing)).toEqual({});
    expect(notACard.requests).toHaveLength(1);
  });
});
