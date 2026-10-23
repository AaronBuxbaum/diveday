import { randomUUID } from "node:crypto";
import { and, asc, eq, gte } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { operationalWindow } from "@/lib/operational-window";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { DEFAULT_WAIVER_TITLE, WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { waiverTemplateHistory } from "@/test/waiver-history";
import {
  bookings,
  people,
  trips,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { createTrip, listStaff } from "./trips";
import { setTripCrew } from "./trips-crew";
import { completeWaiver } from "./waivers-completion";
import { recordInPersonWaiver } from "./waivers-in-person";
import { issueWaiverRequest } from "./waivers-requests";
import {
  getCurrentWaiverGeneration,
  getCurrentWaiverTemplate,
  saveWaiverTemplate,
  standingWaiverExposure,
} from "./waivers-templates";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

describe("waiver records (in-memory PGlite)", () => {
  /**
   * The demo shop ships with superseded wordings already on file
   * (src/db/seed-waiver-versions.ts), so an edit here counts on from whatever
   * version the seed left live rather than from 1. Written against
   * `template.version` on purpose: what these assert is that saving *appends*
   * and that the newest row is current, which is true whatever the shop's
   * history happens to be — pinning the literal would make them a restatement
   * of the seed instead.
   */
  it("saves each edit as the next version and points new links at the current one", async () => {
    const { db, shop, template } = await waiverContext();
    const seeded = template.version;
    expect(seeded).toBeGreaterThan(0);

    const next = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "An updated release, edited by staff and long enough to be valid.",
    });
    expect(next.template.version).toBe(seeded + 1);

    // The newest version is always current.
    const currentNow = await getCurrentWaiverTemplate(db, shop.id);
    expect(currentNow?.id).toBe(next.template.id);
    const history = await waiverTemplateHistory(db, shop.id);
    // Newest first, gapless, all the way back to the shop's first release.
    expect(history.map((row) => row.version)).toEqual(
      Array.from({ length: seeded + 1 }, (_, index) => seeded + 1 - index),
    );
  });

  it("gives concurrent saves distinct, gapless versions instead of colliding (CR-015)", async () => {
    const { db, shop, template } = await waiverContext({ fresh: true });
    const seeded = template.version;

    const [a, b, c] = await Promise.all([
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: template.title,
        body: "Concurrent A body.",
      }),
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: "A different title",
        body: "Concurrent B body.",
      }),
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: template.title,
        body: "Concurrent C body.",
      }),
    ]);

    const versions = [a.template.version, b.template.version, c.template.version].sort(
      (x, y) => x - y,
    );
    expect(versions).toEqual([seeded + 1, seeded + 2, seeded + 3]);
    const history = await waiverTemplateHistory(db, shop.id);
    expect(history.map((row) => row.version)).toEqual(
      Array.from({ length: seeded + 3 }, (_, index) => seeded + 3 - index),
    );
  });

  it("snapshots the highest version on a new link and a paper signature, whatever the clock says", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const older = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "An interim release whose save started second but committed first, long enough to publish.",
    });
    const newer = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "The release that took the lock last and must be what every new signature reads.",
    });
    await db
      .update(waiverTemplates)
      .set({ createdAt: new Date(newer.template.createdAt.getTime() + 60_000) })
      .where(eq(waiverTemplates.id, older.template.id));

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const [linked] = await db
      .select({ templateId: waiverRecords.templateId })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(linked?.templateId).toBe(newer.template.id);

    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      now,
    });
    const [paper] = await db
      .select({ templateId: waiverRecords.templateId })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "completed")));
    expect(paper?.templateId).toBe(newer.template.id);
  });

  it("keeps a completed record faithful to the version it was signed against", async () => {
    const { db, person, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    // Editing the waiver after it was signed must not rewrite the evidence.
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially rewritten release that no signed record should adopt.",
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record?.templateVersion).toBe(template.version);
    expect(record?.templateBody).toBe(template.body);
    expect(record ? verifyWaiverIntegrity(record) : "unsealed").toBe("valid");
  });
});

/**
 * **Pressing Save must not cost a shop every signature it holds.**
 *
 * `isCompletedWaiverCurrent` reads a signature against an older version as no
 * longer current, so publishing a version invalidates the whole shop's signed
 * releases at once — every booked diver on every forward departure flips to
 * blocked. A staffer who opened the editor to read the release and pressed Save
 * on the way out had done exactly that, and been told "Saved" (issue #720).
 */
describe("saving the waiver template", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  async function signedContext() {
    const { db, shop, booking, person, template } = await waiverContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    return { db, shop, template, staff };
  }

  // The demo shop is not a toy fixture here: it carries ~170 signed releases on
  // its current version, which is the ticket's whole point — one tap of Save
  // used to put every one of them back in the queue. So these assert against
  // what the seed actually holds rather than a hand-counted number, and each
  // one first proves the number is non-zero, or "nothing was lost" would pass
  // just as happily against a shop with nothing to lose.

  it("writes no version at all when the body has not changed", async () => {
    const { db, shop, template } = await signedContext();
    const before = await waiverTemplateHistory(db, shop.id);
    const standing = (await standingWaiverExposure(db, shop.id, now)).divers;

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      // Untrimmed on purpose: the editor hands back whatever the textarea
      // holds, and trailing whitespace is not an edit anyone made.
      body: `  ${template.body}  `,
    });

    expect(result.versioned).toBe(false);
    expect(result.template.id).toBe(template.id);
    expect(await waiverTemplateHistory(db, shop.id)).toHaveLength(before.length);
    // Every signature it would have invalidated is untouched, which is the
    // whole point — the history length above only proves nothing was inserted.
    expect(standing).toBeGreaterThan(0);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(standing);
  });

  /**
   * **The shop's own questions are part of the version** (glossary *Shop
   * question*): a list that changes is a new version through the same
   * materiality choice as a body edit, and one that only looks different, a
   * pasted prompt or stray spaces, is not, for the reason an identical body is
   * not (#720).
   */
  it("versions a questions-only edit, through the publisher's own materiality choice", async () => {
    const { db, shop, template } = await signedContext();
    const before = await waiverTemplateHistory(db, shop.id);
    const generation = template.materialGeneration;
    const questions = [
      { id: "insurance01", kind: "yes_no" as const, prompt: "Insured?", required: false },
    ];

    const added = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      questions,
      material: false,
    });
    expect(added.versioned).toBe(true);
    expect(added.template.questions).toEqual(questions);
    expect(added.template.materialGeneration).toBe(generation);
    expect(await waiverTemplateHistory(db, shop.id)).toHaveLength(before.length + 1);
    // Never inferred from "only questions changed": the publisher said material.
    const material = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      questions: [{ ...questions[0], required: true }],
      material: true,
    });
    expect(material.versioned).toBe(true);
    expect(material.template.materialGeneration).toBe(generation + 1);
  });

  it("writes no version when the list is the same after normalisation", async () => {
    const { db, shop, template } = await signedContext();
    const questions = [
      {
        id: "heardabout1",
        kind: "choice" as const,
        prompt: "¿Cómo nos conoció?",
        required: false,
        options: ["Un amigo", "Internet"],
      },
    ];
    const first = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      questions,
      material: false,
    });
    expect(first.versioned).toBe(true);
    const again = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      // What a round trip through the editor can hand back: decomposed
      // accents and stray spaces around the same words.
      questions: [
        {
          ...questions[0],
          prompt: ` ${"¿Cómo nos conoció?".normalize("NFD")} `,
          options: ["Un amigo ", "Internet"],
        },
      ],
    });
    expect(again.versioned).toBe(false);
    expect(again.template.id).toBe(first.template.id);
    // Omitted, the list carries forward like the title, so a caller with no
    // list in hand never removes the shop's questions by accident.
    const bodyEdit = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: `${template.body}\n\nOne more line.`,
      material: false,
    });
    expect(bodyEdit.template.questions).toEqual(questions);
  });

  /**
   * Issue #842. A divemaster who signed the shop's release person-scoped counts
   * in `divers` like anyone else, and must never reach `boardingSoon` on the
   * strength of a crew assignment: the release is the customer's, and joining
   * `trip_crew` into that count is the drive-by this pins against. The
   * function's docblock and the glossary's "waiver / release" entry carry the
   * reasoning.
   */
  it("does not count a crew assignment as boarding soon", async () => {
    const { db, shop, staff } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);

    // The signer of `signedContext` is a diver; give a *crew* member a standing
    // signature and a seat on the crew of a departure inside the horizon.
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: staff.person.id,
      now,
    });
    if (!issued.ok) throw new Error(`crew waiver issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: staff.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), gte(trips.startsAt, now)))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("expected a forward departure");
    await setTripCrew(db, shop.id, trip.id, [staff.person.id]);

    const after = await standingWaiverExposure(db, shop.id, now);
    // The crew member's own signature is exposure, so `divers` moves.
    expect(after.divers).toBe(before.divers + 1);
    // Their crew assignment is not a booking, so the operational number does not.
    expect(after.boardingSoon).toBe(before.boardingSoon);
  });

  it("versions a real edit, and reports the signatures it just put back in the queue", async () => {
    const { db, shop, template } = await signedContext();
    // Counted before the save, which is the only moment the number exists: the
    // new version is current the instant it lands and nothing is signed
    // against it yet.
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeGreaterThan(0);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially different release, long enough to be valid as a version.",
    });

    expect(result.versioned).toBe(true);
    expect(result.template.version).toBe(template.version + 1);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(0);
  });

  it("keeps signatures current for an explicit non-material correction and records the actor", async () => {
    const { db, shop, template, staff } = await signedContext();
    const standing = (await standingWaiverExposure(db, shop.id, now)).divers;
    expect(standing).toBeGreaterThan(0);
    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A typo-fixed release that keeps the same promises and is long enough to publish.",
      material: false,
      actorPersonId: staff.person.id,
    });
    expect(result.template.version).toBe(template.version + 1);
    expect(result.template.materialGeneration).toBe(template.materialGeneration);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(standing);
    const [decision] = await db
      .select()
      .from(waiverMaterialityDecisions)
      .where(eq(waiverMaterialityDecisions.templateId, result.template.id));
    expect(decision).toMatchObject({
      shopId: shop.id,
      material: false,
      actorPersonId: staff.person.id,
    });
  });

  it("advances the material generation for an explicit material revision", async () => {
    const { db, shop, template, staff } = await signedContext();
    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially revised release with a changed promise that is long enough to publish.",
      material: true,
      actorPersonId: staff.person.id,
    });
    expect(result.template.materialGeneration).toBe(template.materialGeneration + 1);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(0);
  });

  it("reads the highest version as current even when an older save committed with a later clock", async () => {
    // Two overlapping saves: `createdAt` is transaction time, taken before the
    // lock, so the lower version can carry the later stamp. Every reader of
    // "which release is current" must still pick the higher version.
    const { db, shop, template, staff } = await signedContext();
    const older = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "An interim release whose save started second but committed first, long enough to publish.",
    });
    const newer = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially revised release that took the lock last and must be current, long enough to publish.",
      material: true,
      actorPersonId: staff.person.id,
    });
    expect(newer.template.version).toBe(older.template.version + 1);
    await db
      .update(waiverTemplates)
      .set({ createdAt: new Date(newer.template.createdAt.getTime() + 60_000) })
      .where(eq(waiverTemplates.id, older.template.id));

    expect((await getCurrentWaiverTemplate(db, shop.id))?.id).toBe(newer.template.id);
    expect(await getCurrentWaiverGeneration(db, shop.id)).toEqual({
      materialGeneration: newer.template.materialGeneration,
    });
    // The exposure count agrees: the material version put every signature back.
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(0);
  });

  it("does not count a signature the validity window has already aged out", async () => {
    const { db, shop } = await signedContext();
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeGreaterThan(0);
    // Far enough past every seeded signature's validity window that none of
    // them stand. Those were not going to clear anyone tomorrow either, so
    // publishing a version costs them nothing — and a number a shop can
    // disprove is a number they stop reading.
    const later = new Date(now.getTime() + WAIVER_SIGNATURE_VALIDITY_MS * 3);
    expect((await standingWaiverExposure(db, shop.id, later)).divers).toBe(0);
  });

  /**
   * **An edit nobody made must not invalidate every signature a shop holds.**
   *
   * Text pasted back from Word, Pages or an email can arrive Unicode-decomposed
   * — `exención` byte-unequal to the identical-looking stored string, with
   * nothing on screen to distinguish them. A Spanish-language shop is the
   * likeliest victim, and the cost is the entire forward roster blocked
   * (`dive-domain-expert`, after #720 shipped).
   *
   * NFC is *canonical equivalence*, so this is not inferring materiality from a
   * diff: the rendered legal document is the same document.
   */
  it("treats a decomposed paste of the same text as no change at all", async () => {
    const { db, shop } = await signedContext();
    // A Spanish release, because that is where this bites: the seeded English
    // body is pure ASCII, where NFD and NFC are the same bytes and the bug is
    // invisible.
    const spanish =
      "Exención de responsabilidad: reconozco los riesgos del buceo, la inmersión " +
      "y la navegación, y participo de forma voluntaria bajo mi propia decisión médica.";
    await saveWaiverTemplate(db, { shopId: shop.id, body: spanish });
    const before = await waiverTemplateHistory(db, shop.id);
    expect(spanish.normalize("NFD")).not.toBe(spanish);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: spanish.normalize("NFD"),
    });

    expect(result.versioned).toBe(false);
    expect(await waiverTemplateHistory(db, shop.id)).toHaveLength(before.length);
  });

  it("carries the shop's own title forward instead of renaming its release", async () => {
    const { db, shop, template } = await waiverContext();
    // The demo shop calls its release "Blue Mantis Diving Release". The editor
    // has no title field, so a save cannot mean "rename" — but it used to pass
    // the platform default, which silently retitled a shop's legal instrument
    // on its first edit.
    expect(template.title).not.toBe(DEFAULT_WAIVER_TITLE);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: "An edit that changes the words and must not change the name of the document.",
    });

    expect(result.versioned).toBe(true);
    expect(result.template.title).toBe(template.title);
  });

  it("counts nothing for a shop that has never published a release", async () => {
    const { db } = await waiverContext();
    expect(await standingWaiverExposure(db, randomUUID(), now)).toEqual({
      divers: 0,
      boardingSoon: 0,
    });
  });

  /**
   * **Divers, not records, and only divers who could still sign.**
   *
   * The count was over `waiver_records` while both strings called them divers,
   * and those are different numbers: one diver can hold several standing
   * records on the current version, because `issueWaiverRequest`'s
   * `alreadyStanding` check for a booking subject only looks at records on
   * *that* booking (issue #790).
   */
  it("counts a diver holding two standing records once", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);
    expect(before.divers).toBeGreaterThan(0);

    // A second completed, non-superseded record on the current version for a
    // diver who already has one — the exact state a staff "Send waiver" on a
    // second seat produces.
    const [existing] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!existing) throw new Error("expected a completed record in the seed");
    await db.insert(waiverRecords).values({
      ...existing,
      id: undefined,
      bookingId: null,
      // `token_hash` is unique — the second link is a second link, which is
      // exactly how this state arises in production.
      tokenHash: `${existing.tokenHash}-second-seat`,
      createdAt: existing.createdAt,
    });

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(before.divers);
  });

  /**
   * **A deleted diver is still on the boat.**
   *
   * `deleteDiver` is "removal from the active lists, not erasure" and leaves
   * the bookings live; `getTripRoster` and `listTripsWaiverStatuses` both
   * honour that. So a soft-deleted diver holding a live seat is on the
   * manifest, is in the readiness queue, and owes a fresh signature — and a
   * number smaller than the boat is the one direction this must not err
   * (`dive-domain-expert`, on issue #790). A shop merging a duplicate diver
   * mid-season is the ordinary way it happens.
   */
  it("still counts a diver the shop deleted, because their booking is still live", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);
    expect(before.divers).toBeGreaterThan(0);

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!record) throw new Error("expected a completed record in the seed");
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, record.personId));

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(before.divers);
  });

  it("does not count a diver the shop erased, who will never sign anything again", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!record) throw new Error("expected a completed record in the seed");
    // Erasure stamps both columns (`anonymizeDiver`), which is why the query
    // asks only about `anonymized_at`.
    await db
      .update(people)
      .set({ anonymizedAt: now, deletedAt: now })
      .where(eq(people.id, record.personId));

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeLessThan(before.divers);
  });

  /**
   * **The operational half.** A three-season shop read "the release that 812
   * divers have signed": accurate, alarming, useless. The number that changes
   * a decision is which boat it lands on this afternoon.
   */
  it("counts only the divers who board inside the operational window as boarding soon", async () => {
    const { db, shop } = await signedContext();
    const exposure = await standingWaiverExposure(db, shop.id, now);

    expect(exposure.divers).toBeGreaterThan(0);
    expect(exposure.boardingSoon).toBeGreaterThan(0);
    // **Strictly fewer**, not merely "no more than". The seeded shop has far
    // more signed divers than it has booked on the next seven days, and the
    // first version of this filter keyed on the *booking* join — which matches
    // any seat on any departure ever — so the two numbers came out equal and
    // the confirm read "127 divers have signed. 127 of them board in the next
    // 7 days." A `<=` assertion passed against exactly that.
    expect(exposure.boardingSoon).toBeLessThan(exposure.divers);
  });

  /**
   * **The window lives on the trip, not the booking.**
   *
   * The first version filtered on `bookings.id is not null` while the horizon
   * sat on a `LEFT JOIN` to `trips` — and a left join cannot eliminate a row
   * from the table on its left, so every diver with any non-cancelled seat on
   * any departure ever was counted as boarding this week. The confirm read
   * "127 divers have signed. 127 of them board in the next 7 days", which is
   * the alarming number restated as an operational one
   * (`dive-domain-expert`, on issue #790).
   *
   * Built explicitly rather than off the seed: two divers, two departures, one
   * inside the horizon and one a day past it.
   */
  it("counts only the diver whose departure falls inside the horizon", async () => {
    const { db, shop, template } = await signedContext();
    const window = operationalWindow(now);

    const sign = async (name: string, startsAt: Date) => {
      const [person] = await db
        .insert(people)
        .values({ shopId: shop.id, fullName: name })
        .returning();
      if (!person) throw new Error("person insert failed");
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: `${name}'s charter`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
        plannedDives: 2,
      });
      if (!trip) throw new Error("trip insert failed");
      const [booking] = await db
        .insert(bookings)
        .values({
          bookedAs: "diver",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
          status: "booked",
        })
        .returning();
      if (!booking) throw new Error("booking insert failed");
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
      if (!issued.ok) throw new Error("expected a waiver link");
      await completeWaiver(db, issued.token, {
        signerName: name,
        agreed: true,
        medicalAnswers: clearAnswers,
      });
      return { person, trip };
    };

    const before = await standingWaiverExposure(db, shop.id, now);
    await sign("Inside The Horizon", new Date(window.to.getTime() - 60 * 60 * 1000));
    await sign("Outside The Horizon", new Date(window.to.getTime() + 24 * 60 * 60 * 1000));

    const after = await standingWaiverExposure(db, shop.id, now);
    // Both signed, so both are exposure…
    expect(after.divers).toBe(before.divers + 2);
    // …and exactly one of them boards inside the window.
    expect(after.boardingSoon).toBe(before.boardingSoon + 1);
    void template;
  });

  /**
   * **A called-off Saturday has nobody boarding on it.** `liveTrip()` is only
   * `deleted_at is null`; a blow-out sets `status = 'cancelled'` and leaves the
   * bookings alone until staff work the cascade per seat, so without the status
   * filter a cancelled departure still counted a boatload.
   */
  it("does not count a diver whose departure inside the horizon was canceled", async () => {
    const { db, shop } = await signedContext();
    const window = operationalWindow(now);
    const startsAt = new Date(window.to.getTime() - 60 * 60 * 1000);

    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Blown Out" })
      .returning();
    if (!person) throw new Error("person insert failed");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Blown out charter",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip insert failed");
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        status: "booked",
      })
      .returning();
    if (!booking) throw new Error("booking insert failed");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: "Blown Out",
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const sailing = await standingWaiverExposure(db, shop.id, now);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const calledOff = await standingWaiverExposure(db, shop.id, now);

    // Still owed a signature — the departure went away, the void one did not.
    expect(calledOff.divers).toBe(sailing.divers);
    // But not boarding this week.
    expect(calledOff.boardingSoon).toBe(sailing.boardingSoon - 1);
  });

  it("counts nobody as boarding soon when no departure falls inside the horizon", async () => {
    const { db, shop } = await signedContext();
    // Ninety days *before* the seeded schedule, so the window [now, now+7d]
    // closes long before the first departure. Moving `now` forward would not
    // do it — the window travels with it and keeps finding departures.
    //
    // The validity check is a lower bound (`signedAt > now - validity`), so
    // every signature still stands from here, which is the half that makes
    // this a test of the horizon rather than of signature ageing.
    const beforeTheSeason = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const early = await standingWaiverExposure(db, shop.id, beforeTheSeason);
    expect(early.divers).toBeGreaterThan(0);
    expect(early.boardingSoon).toBe(0);
  });
});
