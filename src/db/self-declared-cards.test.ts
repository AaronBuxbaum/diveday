import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decideTripAdmission } from "@/lib/trip-admission";
import { seededShopContext } from "@/test/db";
import { createNitroxCertification, reviewNitroxCertification } from "./nitrox";
import { findOrCreatePerson } from "./people";
import { archiveCertification, createCertification, reviewCertification } from "./readiness";
import { certifications, nitroxCertifications } from "./schema";
import { listDeclaredDiveProfiles, recordSelfDeclaredCards } from "./self-declared-cards";

/**
 * The writer behind both public "tell me when something comes up" join forms
 * (FU-20260813). Its whole job is to record a level a **stranger typed about
 * themselves** in a way that can never be mistaken for evidence, on a path
 * anybody on the internet can post to.
 */

async function joiner(name = "Nora Quinn", email = "nora@example.com") {
  const { db, shop } = await seededShopContext();
  const { person } = await findOrCreatePerson(db, {
    shopId: shop.id,
    fullName: name,
    email,
  });
  return { db, shop, person };
}

async function liveCards(db: Awaited<ReturnType<typeof joiner>>["db"], shopId: string) {
  return db
    .select()
    .from(certifications)
    .where(and(eq(certifications.shopId, shopId), isNull(certifications.deletedAt)));
}

describe("recordSelfDeclaredCards", () => {
  it("records a declared level as a pending, self-declared card with no card number", async () => {
    const { db, shop, person } = await joiner();

    const outcome = await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "advanced_open_water",
      nitrox: true,
    });

    expect(outcome).toEqual({ level: "recorded", nitrox: "recorded" });
    const [card] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(card?.level).toBe("advanced_open_water");
    // Pending, never verified: nobody has seen anything.
    expect(card?.status).toBe("pending");
    expect(card?.selfDeclaredAt).not.toBeNull();
    // A card number is absent rather than faked — "PENDING" in this column gets
    // read as a card number eventually.
    expect(card?.identifier).toBeNull();
    // Not `importedAt`: a CSV a shop uploaded is a different and more
    // trustworthy thing than a stranger's typing, and the two must stay apart.
    expect(card?.importedAt).toBeNull();

    const [nitrox] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, person.id));
    expect(nitrox?.status).toBe("pending");
    expect(nitrox?.identifier).toBeNull();
    expect(nitrox?.selfDeclaredAt).not.toBeNull();
  });

  it("records nothing when the joiner skipped both questions", async () => {
    const { db, shop, person } = await joiner();

    const outcome = await recordSelfDeclaredCards(db, { shopId: shop.id, personId: person.id });

    expect(outcome).toEqual({ level: "not_said", nitrox: "not_said" });
    expect((await liveCards(db, shop.id)).filter((row) => row.personId === person.id)).toEqual([]);
  });

  it("treats an unticked nitrox box as silence, not as 'I am not nitrox certified'", async () => {
    const { db, shop, person } = await joiner();
    await createNitroxCertification(db, {
      shopId: shop.id,
      personId: person.id,
      agency: "padi",
      identifier: "NX-7781",
    });

    const outcome = await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      nitrox: false,
    });

    expect(outcome.nitrox).toBe("not_said");
    const rows = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, person.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).toBe("NX-7781");
  });

  it("updates a repeat joiner's own earlier declaration rather than stacking rows", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "open_water",
    });

    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "rescue",
    });

    const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.level).toBe("rescue");
  });

  /**
   * **The anti-displacement rule.** Anyone can post an existing diver's email
   * address to these forms and land on that diver's real `people` row. A real
   * card must therefore win outright — not be overwritten, not be downgraded,
   * and not be sat next to by a louder claim.
   */
  describe("never displaces a card the shop actually holds", () => {
    it("writes nothing when a verified card is already on file", async () => {
      const { db, shop, person } = await joiner();
      const card = await createCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: "OW-1234",
      });
      if (!card) throw new Error("setup: card not created");
      await reviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        status: "verified",
      });

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "instructor",
      });

      expect(outcome.level).toBe("card_on_file");
      const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.level).toBe("open_water");
      expect(mine[0]?.status).toBe("verified");
      expect(mine[0]?.identifier).toBe("OW-1234");
    });

    it("writes nothing when a staff-captured card is merely pending", async () => {
      const { db, shop, person } = await joiner();
      await createCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "ssi",
        level: "open_water",
        identifier: "SSI-99",
      });

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "divemaster",
      });

      // A staffer already holding the card outranks a claim whatever its
      // review state — `pending` there means "typed, not yet looked up", not
      // "unproven".
      expect(outcome.level).toBe("card_on_file");
      const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.level).toBe("open_water");
    });

    /**
     * **The hole in this rule, and the worst bug this feature shipped with.**
     *
     * A card the diver declared and a staffer has since **sighted** keeps its
     * `selfDeclaredAt` stamp forever — provenance is history, and the ADR chose
     * that deliberately. The guard asked `selfDeclaredAt === null` ("is this row
     * not self-declared"), which such a row answers *false* to, so it did not
     * count as a card on file: the row was picked as the joiner's "own earlier
     * statement" and its `level` overwritten while `status: 'verified'`, the
     * agency, the real card number and `reviewedAt` all stayed put.
     *
     * An anonymous POST carrying nothing but the diver's email address and the
     * shop's public slug therefore turned a verified Open Water card into a
     * verified **Instructor** card with a genuine number on it — clearing
     * `decideTripAdmission`, every `hasVerifiedCertificationAtLeast` course
     * prerequisite, and `certificationBlocker` (so the manifest read *ready*),
     * and lifting the diver's depth advisory to 40 m. Nothing on the staff
     * record would have looked wrong, because the same predicate decides
     * whether the diver page renders it as a claim.
     */
    it("writes nothing when the shop has since sighted the card behind an earlier claim", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "open_water",
      });
      const [claim] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      if (!claim) throw new Error("setup: declaration not recorded");
      const sighted = await reviewCertification(db, {
        shopId: shop.id,
        certificationId: claim.id,
        status: "verified",
        sighting: { agency: "padi", identifier: "OW-9090", level: "open_water" },
      });
      expect(sighted.ok).toBe(true);
      const [before] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "instructor",
      });

      expect(outcome.level).toBe("card_on_file");
      const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      expect(mine).toHaveLength(1);
      // Not "the level is still open_water" but "the row did not move at all":
      // the stamp is the field the nitrox twin of this bug corrupted, and
      // `reviewedAt` is what an incident review would read.
      expect(mine[0]).toEqual(before);
      expect(mine[0]?.level).toBe("open_water");
      expect(mine[0]?.status).toBe("verified");
      expect(mine[0]?.identifier).toBe("OW-9090");
    });
  });

  describe("never displaces a nitrox card the shop actually holds", () => {
    it("writes nothing when a staff-captured nitrox card is on file", async () => {
      const { db, shop, person } = await joiner();
      await createNitroxCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        identifier: "NX-100",
      });

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        nitrox: true,
      });

      expect(outcome.nitrox).toBe("card_on_file");
      const rows = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.selfDeclaredAt).toBeNull();
    });

    /**
     * The same one-line bug as the level twin above. A nitrox row has no level
     * to escalate, so what it corrupted instead was `selfDeclaredAt` on a card
     * a staffer had sighted — anonymously re-dating the provenance of the row
     * that authorizes a gas fill.
     */
    it("writes nothing when the shop has since sighted the card behind an earlier tick", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, { shopId: shop.id, personId: person.id, nitrox: true });
      const [claim] = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      if (!claim) throw new Error("setup: declaration not recorded");
      await reviewNitroxCertification(db, {
        shopId: shop.id,
        certificationId: claim.id,
        status: "verified",
        sighting: { agency: "padi", identifier: "NX-4242" },
      });
      const [before] = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        nitrox: true,
      });

      expect(outcome.nitrox).toBe("card_on_file");
      const rows = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(before);
    });
  });
});

describe("self-declared cards and the booking gate", () => {
  /**
   * `decideTripAdmission`'s docstring required exactly this the moment cards
   * became diver-writable: without it, a diver refused an Advanced-only charter
   * could type "Instructor" into a marketing opt-in and be admitted on the next
   * attempt, having asserted nothing.
   */
  it("a self-declared level does not lift the diver past a trip's requirement", async () => {
    const { db, shop, person } = await joiner();
    const verified = await createCertification(db, {
      shopId: shop.id,
      personId: person.id,
      agency: "padi",
      level: "open_water",
      identifier: "OW-5555",
    });
    if (!verified) throw new Error("setup: card not created");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: verified.id,
      status: "verified",
    });
    // Forced past the anti-displacement rule, because the gate has to hold even
    // if a row like this reaches it some other way.
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: person.id,
      agency: "other",
      level: "instructor",
      identifier: null,
      status: "pending",
      selfDeclaredAt: new Date("2026-08-14T00:00:00Z"),
    });

    const evidence = {
      certifications: (await liveCards(db, shop.id)).filter((row) => row.personId === person.id),
      specialtyCertifications: [],
      nitroxCertifications: [],
    };

    const decision = decideTripAdmission({
      requirement: {
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: [],
        requiresNitrox: false,
      },
      siteRequirement: null,
      evidence,
    });

    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.refusal.requiredLevel).toBe("advanced_open_water");
    // The level the *shop* has evidence for, not the one the diver typed.
    expect(decision.refusal.heldLevel).toBe("open_water");
  });

  it("a self-declared nitrox tick does not clear a nitrox-gated trip", async () => {
    const { db, shop, person } = await joiner();
    const verified = await createCertification(db, {
      shopId: shop.id,
      personId: person.id,
      agency: "padi",
      level: "rescue",
      identifier: "R-2020",
    });
    if (!verified) throw new Error("setup: card not created");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: verified.id,
      status: "verified",
    });
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId: person.id, nitrox: true });

    const decision = decideTripAdmission({
      requirement: {
        minimumCertificationLevel: null,
        requiredSpecialties: [],
        requiresNitrox: true,
      },
      siteRequirement: null,
      evidence: {
        certifications: (await liveCards(db, shop.id)).filter((row) => row.personId === person.id),
        specialtyCertifications: [],
        nitroxCertifications: await db
          .select()
          .from(nitroxCertifications)
          .where(eq(nitroxCertifications.personId, person.id)),
      },
    });

    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.refusal.nitroxRequired).toBe(true);
  });

  it("admits a diver the shop knows nothing about but a claim, rather than refusing them", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "open_water",
    });

    const decision = decideTripAdmission({
      requirement: {
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: [],
        requiresNitrox: false,
      },
      siteRequirement: null,
      evidence: {
        certifications: (await liveCards(db, shop.id)).filter((row) => row.personId === person.id),
        specialtyCertifications: [],
        nitroxCertifications: [],
      },
    });

    // Absence of evidence has never been a refusal here, and a stranger's
    // typing must not turn "unknown" into "known and too junior" — that would
    // let this feature *cost* somebody a seat they could have had.
    expect(decision.admitted).toBe(true);
  });
});

describe("reviewCertification on a self-declared card", () => {
  it("refuses the one tap every other pending card gets", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "open_water",
    });
    const [card] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    if (!card) throw new Error("setup: declaration not recorded");

    const outcome = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });

    expect(outcome).toEqual({ ok: false, reason: "card_sighting_required" });
    const [after] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(after?.status).toBe("pending");
  });

  it("certifies once the staffer enters the card in front of them, and records it", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "open_water",
    });
    const [card] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    if (!card) throw new Error("setup: declaration not recorded");

    const outcome = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      sighting: { agency: "padi", identifier: " OW-4242 ", level: "open_water" },
    });

    expect(outcome.ok).toBe(true);
    const [after] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(after?.status).toBe("verified");
    expect(after?.agency).toBe("padi");
    expect(after?.identifier).toBe("OW-4242");
    // Provenance is history and stays — but it no longer reads as a bare claim,
    // because the row is `verified` now.
    expect(after?.selfDeclaredAt).not.toBeNull();
  });

  /**
   * **A sighting must not promote the level the diver typed.**
   *
   * Overstating is the likely wrong claim, not the exotic one. The sighting
   * used to write only the agency and number, so a staffer transcribing a
   * genuine Open Water card onto a row claiming "instructor" verified the
   * Instructor rung — the one field on that card nobody had looked at.
   */
  it("writes the level the staffer read off the card, not the one the diver claimed", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "instructor",
    });
    const [card] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    if (!card) throw new Error("setup: declaration not recorded");

    const outcome = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      sighting: { agency: "padi", identifier: "OW-3131", level: "open_water" },
    });

    expect(outcome.ok).toBe(true);
    const [after] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(after?.level).toBe("open_water");
    expect(after?.status).toBe("verified");
  });

  /**
   * `CardSightingForm` tells staff the right answer to a bad claim is often to
   * delete it, so the replayed POST is a real shape and not a hypothetical: the
   * form is still on the previous render of the page. Both sibling review paths
   * carry this clause and cite the earlier `security-reviewer` finding that put
   * it there; this one did not.
   */
  it("refuses to re-verify a card that has since been deleted", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "instructor",
    });
    const [card] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    if (!card) throw new Error("setup: declaration not recorded");
    expect(await archiveCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );

    const outcome = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      sighting: { agency: "padi", identifier: "OW-7777", level: "open_water" },
    });

    expect(outcome).toEqual({ ok: false, reason: "not_found" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe("pending");
  });

  it("never lets a sighting rewrite the number on a card a staffer captured", async () => {
    const { db, shop, person } = await joiner();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: person.id,
      agency: "ssi",
      level: "open_water",
      identifier: "SSI-4001",
    });
    if (!card) throw new Error("setup: card not created");

    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      sighting: { agency: "padi", identifier: "SOMETHING-ELSE", level: "instructor" },
    });

    const [after] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    expect(after?.agency).toBe("ssi");
    expect(after?.identifier).toBe("SSI-4001");
    // And not the level either, now that a sighting carries one: a staffer's
    // own capture is not a row a later "sighting" may re-grade.
    expect(after?.level).toBe("open_water");
  });
});

describe("listDeclaredDiveProfiles", () => {
  it("marks a claim and leaves a real card unmarked", async () => {
    const { db, shop, person } = await joiner();
    const other = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Rafa Ortiz",
      email: "rafa@example.com",
    });
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "open_water",
      nitrox: true,
    });
    const carded = await createCertification(db, {
      shopId: shop.id,
      personId: other.person.id,
      agency: "padi",
      level: "divemaster",
      identifier: "DM-7",
    });
    if (!carded) throw new Error("setup: card not created");

    const profiles = await listDeclaredDiveProfiles(db, shop.id, [person.id, other.person.id]);

    expect(profiles.get(person.id)).toEqual({
      level: "open_water",
      levelSelfDeclared: true,
      nitrox: true,
      nitroxSelfDeclared: true,
    });
    expect(profiles.get(other.person.id)).toEqual({
      level: "divemaster",
      levelSelfDeclared: false,
      nitrox: false,
      nitroxSelfDeclared: false,
    });
  });

  it("has nothing to say about a joiner who said nothing", async () => {
    const { db, shop, person } = await joiner();

    const profiles = await listDeclaredDiveProfiles(db, shop.id, [person.id]);

    expect(profiles.get(person.id)).toBeUndefined();
  });
});
