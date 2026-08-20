import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { decideTripAdmission } from "@/lib/trip-admission";
import { seededShopContext } from "@/test/db";
import { createNitroxCertification, reviewNitroxCertification } from "./nitrox";
import { findOrCreatePerson } from "./people";
import {
  createCertification,
  createSpecialtyCertification,
  deleteCertification,
  reviewCertification,
} from "./readiness";
import { certifications, nitroxCertifications, people, shops } from "./schema";
import {
  clearNoCertificationDeclaration,
  listCertificationSummaries,
  recordSelfDeclaredCards,
} from "./self-declared-cards";

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

    expect(outcome).toEqual({
      level: "recorded",
      noCertification: "not_said",
      nitrox: "recorded",
    });
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

    expect(outcome).toEqual({
      level: "not_said",
      noCertification: "not_said",
      nitrox: "not_said",
    });
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
   * **"I'm not certified yet" — the answer that is not a card.**
   *
   * A large share of the people joining these lists at a Florida or Caribbean
   * shop hold none: Discover Scuba and Try Scuba customers, snorkellers, the
   * non-diving half of a couple. Until this answer existed their only honest
   * option was "Rather not say", which reads to staff exactly like a certified
   * regular who skipped the question — so the shop mailed them a certified
   * two-tank charter (ADR 20260814-self-declared-cards, amendment 2026-08-15).
   */
  describe("a joiner who says they hold no card", () => {
    async function stamp(
      db: Awaited<ReturnType<typeof joiner>>["db"],
      shopId: string,
      personId: string,
    ) {
      const [row] = await db
        .select({ at: people.noCertificationDeclaredAt })
        .from(people)
        .where(and(eq(people.id, personId), eq(people.shopId, shopId)));
      return row?.at ?? null;
    }

    /**
     * The assertion this whole design exists for. A Discover Scuba experience
     * is not a certification, and "DSD certification" is the phrase that costs
     * a dive business its credibility with an instructor — but the structural
     * reason is stronger than the words: every row in `certifications` asserts
     * that a card exists, and a row asserting the opposite would have to be
     * special-cased by readiness, admission, the CSV export, the incident
     * document and the importer. The one reader that missed it would turn "no
     * card" into a card.
     */
    it("writes a stamp on the person and no certification row at all", async () => {
      const { db, shop, person } = await joiner();

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome).toEqual({
        level: "not_said",
        noCertification: "recorded",
        nitrox: "not_said",
      });
      expect(await stamp(db, shop.id, person.id)).not.toBeNull();
      // Not a live row, and not a soft-deleted one either: nothing was written
      // to this table on this path, ever.
      const anyRow = await db
        .select()
        .from(certifications)
        .where(eq(certifications.personId, person.id));
      expect(anyRow).toEqual([]);
      const anyNitrox = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      expect(anyNitrox).toEqual([]);
    });

    it("refuses to record a level and a 'no card at all' from the same submission", async () => {
      const { db, shop, person } = await joiner();

      // One `<select>` cannot post both, so a caller sending both is
      // contradicting itself — and two claims on a safety record is the worse
      // outcome of the two. The statement that there is nothing wins.
      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
        level: "instructor",
        nitrox: true,
      });

      expect(outcome.noCertification).toBe("recorded");
      expect(outcome.level).toBe("not_said");
      expect(outcome.nitrox).toBe("not_said");
      expect(
        await db.select().from(certifications).where(eq(certifications.personId, person.id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(nitroxCertifications)
          .where(eq(nitroxCertifications.personId, person.id)),
      ).toEqual([]);
    });

    /**
     * The anti-displacement rule, widened to both tables because the claim
     * here is "there is no card" and *any* card the shop holds refutes it. The
     * forms are unauthenticated: anybody who knows a diver's name and email
     * address reaches that diver's real record.
     */
    it("writes nothing when the shop holds a real level card", async () => {
      const { db, shop, person } = await joiner();
      const card = await createCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "rescue",
        identifier: "R-3131",
      });
      if (!card) throw new Error("setup: card not created");

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome.noCertification).toBe("card_on_file");
      expect(await stamp(db, shop.id, person.id)).toBeNull();
      const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.level).toBe("rescue");
    });

    it("writes nothing when the shop holds a specialty card and nothing else", async () => {
      const { db, shop, person } = await joiner();
      await createSpecialtyCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        specialty: "deep",
        identifier: "DEEP-4004",
      });

      // `specialty_certifications` has no `self_declared_at` — these forms
      // cannot write there, so a row's existence is the whole answer, and a
      // diver holding a Deep card is not a diver with no card.
      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome.noCertification).toBe("card_on_file");
      expect(await stamp(db, shop.id, person.id)).toBeNull();
    });

    it("writes nothing when the shop holds a real nitrox card and no level card", async () => {
      const { db, shop, person } = await joiner();
      await createNitroxCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        identifier: "NX-808",
      });

      // A nitrox card is a card, and nobody holds one without a level behind
      // it. Stamping "not certified" over the top would be an anonymous post
      // contradicting the shop's own evidence.
      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome.noCertification).toBe("card_on_file");
      expect(await stamp(db, shop.id, person.id)).toBeNull();
      const rows = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      expect(rows[0]?.deletedAt).toBeNull();
    });

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
        sighting: { agency: "padi", identifier: "OW-1212", level: "open_water" },
      });
      expect(sighted.ok).toBe(true);

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      // The sighted row keeps its `selfDeclaredAt` forever, so the guard has to
      // be `isUnsightedSelfDeclaration` and never "was this self-declared" —
      // the same one-line hole that let an anonymous post re-grade a verified
      // card to Instructor.
      expect(outcome.noCertification).toBe("card_on_file");
      expect(await stamp(db, shop.id, person.id)).toBeNull();
      const mine = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.status).toBe("verified");
    });

    /**
     * A diver who declared "Instructor" and later says "I'm not certified yet"
     * has corrected themselves **downward**, which is the direction that
     * matters. Leaving the higher claim live would let it outlive its own
     * retraction on every panel that reads it.
     */
    it("retracts the joiner's own earlier claims rather than sitting beside them", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "instructor",
        nitrox: true,
      });

      const outcome = await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome.noCertification).toBe("recorded");
      expect((await liveCards(db, shop.id)).filter((row) => row.personId === person.id)).toEqual(
        [],
      );
      // Archived, not destroyed: the row and its provenance survive for anyone
      // reconstructing what was said and when (ADR 20260719-crud-archive-semantics).
      const archived = await db
        .select()
        .from(certifications)
        .where(eq(certifications.personId, person.id));
      expect(archived).toHaveLength(1);
      expect(archived[0]?.deletedAt).not.toBeNull();
      expect(archived[0]?.selfDeclaredAt).not.toBeNull();
      const nitrox = await db
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.personId, person.id));
      expect(nitrox[0]?.deletedAt).not.toBeNull();
    });

    /**
     * The stamp is **ignored, not deleted**, once a card arrives — where a
     * record began is history, exactly as `self_declared_at` is kept after a
     * sighting. The precedence lives in one place, the phrase that renders
     * them, and `listCertificationSummaries` reports both facts raw.
     */
    it("keeps the stamp when a real card later arrives, and the summary reads the card", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });
      const card = await createCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: "OW-6161",
      });
      if (!card) throw new Error("setup: card not created");

      // The column keeps it — where a record began is history, and nothing
      // clears it but erasure. The *reader* is where it stops being repeated.
      expect(await stamp(db, shop.id, person.id)).not.toBeNull();
      expect((await listCertificationSummaries(db, shop.id, [person.id])).get(person.id)).toEqual({
        level: "open_water",
        levelSelfDeclared: false,
        noCertificationDeclared: false,
        nitrox: false,
        nitroxSelfDeclared: false,
      });
    });

    /**
     * A claim is not a card, so it does not refute the stamp — but it is the
     * later and more specific statement, so the phrase draws it. Both flags
     * ride out of the reader and `certificationSummaryText` settles which one a
     * staffer sees.
     */
    it("keeps the stamp beside a level the diver later claimed, and the phrase draws the claim", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        level: "open_water",
      });

      expect((await listCertificationSummaries(db, shop.id, [person.id])).get(person.id)).toEqual({
        level: "open_water",
        levelSelfDeclared: true,
        noCertificationDeclared: true,
        nitrox: false,
        nitroxSelfDeclared: false,
      });
    });

    /**
     * **The reader ignores the stamp on the same test the writer refuses to
     * write against.** A `dive-domain-expert` review found the two disagreeing:
     * the writer was refuted by all three card tables, the reader only by a
     * level — so a diver whose shop holds a verified *nitrox* card and no level
     * card read as "Not certified yet — diver's word, Nitrox", warning-toned,
     * and was lifted to the top of the send list. Nobody holds enriched air
     * without a level behind it; that is a sentence no instructor would write.
     */
    it("stops reporting the stamp once the shop holds a nitrox card and no level card", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });
      await createNitroxCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        identifier: "NX-2020",
      });

      const summary = (await listCertificationSummaries(db, shop.id, [person.id])).get(person.id);

      // The column keeps the answer — provenance is history — and the reader
      // stops repeating it in front of evidence.
      expect(await stamp(db, shop.id, person.id)).not.toBeNull();
      expect(summary?.noCertificationDeclared).toBe(false);
      expect(summary?.nitrox).toBe(true);
      expect(summary?.nitroxSelfDeclared).toBe(false);
    });

    it("stops reporting the stamp once the shop holds a specialty card", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });
      await createSpecialtyCertification(db, {
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        specialty: "deep",
        identifier: "DEEP-7",
      });

      const summary = (await listCertificationSummaries(db, shop.id, [person.id])).get(person.id);

      // A specialty never joins the phrase — it is not a rung — but it is a
      // card, and "this diver has no card at all" is false in front of one.
      expect(summary?.noCertificationDeclared).toBe(false);
    });

    it("keeps reporting the stamp when the only thing beside it is another claim", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });
      // A later join, ticking nitrox only. Nothing here is evidence, so nothing
      // here refutes the earlier answer.
      await recordSelfDeclaredCards(db, { shopId: shop.id, personId: person.id, nitrox: true });

      const summary = (await listCertificationSummaries(db, shop.id, [person.id])).get(person.id);

      expect(summary?.noCertificationDeclared).toBe(true);
      expect(summary?.nitroxSelfDeclared).toBe(true);
    });

    it("never reaches a person at another shop", async () => {
      const { db, shop, person } = await joiner();
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef", timezone: "America/New_York" })
        .returning();
      if (!rival) throw new Error("setup: rival shop not created");

      // The public forms resolve a shop from a slug in the URL and a person
      // from an email; a caller holding one shop's id and another shop's person
      // must come away with nothing written and nothing considered.
      const outcome = await recordSelfDeclaredCards(db, {
        shopId: rival.id,
        personId: person.id,
        noCertification: true,
      });

      expect(outcome.noCertification).toBe("not_said");
      expect(await stamp(db, shop.id, person.id)).toBeNull();
    });

    /**
     * The gate has never read a claim and does not start now. A person with no
     * evidence at all is admitted — absence of evidence is not a refusal — and
     * saying "I'm not certified yet" must not become the one way a diver talks
     * themselves *out* of a seat a staffer could have cleared them for.
     */
    it("does not refuse a booking the shop would otherwise have allowed", async () => {
      const { db, shop, person } = await joiner();
      await recordSelfDeclaredCards(db, {
        shopId: shop.id,
        personId: person.id,
        noCertification: true,
      });

      const decision = decideTripAdmission({
        requirement: {
          minimumCertificationLevel: "open_water",
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        siteRequirement: null,
        evidence: {
          certifications: (await liveCards(db, shop.id)).filter(
            (row) => row.personId === person.id,
          ),
          specialtyCertifications: [],
          nitroxCertifications: [],
        },
      });

      expect(decision.admitted).toBe(true);
    });
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
   * **Reversed 2026-08-20 (H-27/H-29).** These three tests used to pin the
   * opposite rule — that a claim lifts nothing and clears nothing at booking.
   * The product owner's call is that before a trip an attested card is taken at
   * its word, and the sighting is required at *boarding* instead
   * (`certificationBlocker` still clears on `verified` alone, and
   * `readiness.test.ts` holds that line).
   *
   * The self-attestation the old rule guarded against is real and is now
   * accepted with open eyes: a diver who wants past this gate can type a
   * different rung. It was never the gate that keeps them off the boat.
   */
  it("a self-declared level is believed, even beside a lower card the shop verified", async () => {
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

    // The declared Instructor is the highest rung on the record, so it answers
    // the Advanced gate. What the shop *verified* is Open Water, and that is
    // still the only thing readiness will accept at the dock.
    expect(decision.admitted).toBe(true);
  });

  it("a self-declared nitrox tick clears the sale on a nitrox-gated trip", async () => {
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

    // The seat is sellable; the fill is not. `verifiedNitroxPersonIds` and the
    // manifest still read a sighted card, so this diver cannot be given enriched
    // air on the strength of a tick.
    expect(decision.admitted).toBe(true);
  });

  it("refuses a diver whose own claim puts them below the trip's rung", async () => {
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

    // This is the case the reversal deliberately costs: a diver who says Open
    // Water on an Advanced charter is now told so at the sale rather than at the
    // dock. It is the refusal H-27 wanted — the one that reaches somebody while
    // they can still book the trip they can dive — and the notice names the
    // trip's requirement and the shop's contact address.
    expect(decision.admitted).toBe(false);
    if (decision.admitted) return;
    expect(decision.refusal.requiredLevel).toBe("advanced_open_water");
    expect(decision.refusal.heldLevel).toBe("open_water");
  });

  it("still admits a diver who has said nothing at all — H-08's fail-open promise", async () => {
    const { db, shop, person } = await joiner();

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

    // Zero rows is the fail-open case and it did not move: every genuinely new
    // customer still books. Believing a claim only ever judges a diver who
    // volunteered something.
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
    expect(await deleteCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(true);

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

describe("listCertificationSummaries", () => {
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

    const profiles = await listCertificationSummaries(db, shop.id, [person.id, other.person.id]);

    expect(profiles.get(person.id)).toEqual({
      level: "open_water",
      levelSelfDeclared: true,
      noCertificationDeclared: false,
      nitrox: true,
      nitroxSelfDeclared: true,
    });
    expect(profiles.get(other.person.id)).toEqual({
      level: "divemaster",
      levelSelfDeclared: false,
      noCertificationDeclared: false,
      nitrox: false,
      nitroxSelfDeclared: false,
    });
  });

  it("has nothing to say about a joiner who said nothing", async () => {
    const { db, shop, person } = await joiner();

    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);

    expect(profiles.get(person.id)).toBeUndefined();
  });

  /**
   * The one summary with no card behind it at all. It has to exist — the
   * alternative is that the most safety-relevant answer on the form is the one
   * that renders as an empty row, which is where this started.
   */
  it("reports a joiner whose only answer was that they hold no card", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      noCertification: true,
    });

    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);

    expect(profiles.get(person.id)).toEqual({
      level: null,
      levelSelfDeclared: false,
      noCertificationDeclared: true,
      nitrox: false,
      nitroxSelfDeclared: false,
    });
  });
});

/**
 * **The eraser for a stamp a stranger left.** The forms that write
 * `no_certification_declared_at` are unauthenticated and resolve a person by
 * shop + email, so for a diver the shop holds no card for, anybody with a name
 * and an email address off a manifest could mark them permanently. Until this
 * writer the only thing that cleared it was owner-only erasure of the whole
 * record.
 *
 * Every test below is really one property: **clearing can only reach silence.**
 * It supersedes a statement; it never creates, promotes or touches a card.
 */
describe("clearNoCertificationDeclaration", () => {
  async function stamped() {
    const context = await joiner();
    await recordSelfDeclaredCards(context.db, {
      shopId: context.shop.id,
      personId: context.person.id,
      noCertification: true,
    });
    return context;
  }

  const staffOf = async (db: Awaited<ReturnType<typeof joiner>>["db"], shopId: string) =>
    (
      await findOrCreatePerson(db, {
        shopId,
        fullName: "Dana Reyes",
        email: "dana@example.com",
      })
    ).person;

  it("supersedes the stamp, names who corrected it, and stops the reader reporting it", async () => {
    const { db, shop, person } = await stamped();
    const staff = await staffOf(db, shop.id);

    const cleared = await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: staff.id,
    });

    expect(cleared).toBe(true);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    // Superseded, never deleted: where a record began is history, exactly as
    // `certifications.self_declared_at` is kept after a sighting. A shop has to
    // be able to answer "did this diver ever tell us that?".
    expect(row?.noCertificationDeclaredAt).not.toBeNull();
    expect(row?.noCertificationClearedAt).not.toBeNull();
    expect(row?.noCertificationClearedByPersonId).toBe(staff.id);

    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);
    expect(profiles.get(person.id)).toBeUndefined();
  });

  it("cannot turn a claim into evidence — it leaves every card table untouched", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "instructor",
    });
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      noCertification: true,
    });
    const staff = await staffOf(db, shop.id);

    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: staff.id,
    });

    // The "Instructor" claim this diver retracted is still archived, and no row
    // anywhere reached `verified`. Clearing the stamp is a statement about a
    // statement; the only path from claim to evidence is still a card sighting.
    const live = await liveCards(db, shop.id);
    expect(live.filter((row) => row.personId === person.id)).toHaveLength(0);
    const all = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, person.id));
    expect(all.every((row) => row.status === "pending")).toBe(true);
    expect(all.every((row) => row.identifier === null)).toBe(true);
  });

  it("refuses a person at another shop", async () => {
    const { db, shop, person } = await stamped();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other shop", slug: "other-shop", timezone: "UTC" })
      .returning();

    const cleared = await clearNoCertificationDeclaration(db, {
      shopId: other?.id ?? "",
      personId: person.id,
      byPersonId: person.id,
    });

    expect(cleared).toBe(false);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.noCertificationClearedAt).toBeNull();
    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);
    expect(profiles.get(person.id)?.noCertificationDeclared).toBe(true);
  });

  it("reports nothing to clear rather than stamping a correction that did not happen", async () => {
    const { db, shop, person } = await joiner();
    const staff = await staffOf(db, shop.id);

    const cleared = await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: staff.id,
    });

    expect(cleared).toBe(false);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.noCertificationClearedAt).toBeNull();
  });

  it("is idempotent — a replayed submit never rewrites who corrected it, or when", async () => {
    const { db, shop, person } = await stamped();
    const first = await staffOf(db, shop.id);
    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: first.id,
    });
    const [after] = await db.select().from(people).where(eq(people.id, person.id));
    const { person: second } = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Sam Ortiz",
      email: "sam@example.com",
    });

    const again = await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: second.id,
    });

    expect(again).toBe(false);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.noCertificationClearedByPersonId).toBe(first.id);
    expect(row?.noCertificationClearedAt).toEqual(after?.noCertificationClearedAt);
  });

  /**
   * The half that would otherwise be a silent, permanent gate: one correction
   * must not swallow every answer the diver gives afterwards. Nobody chose
   * that, and nothing on any screen would say it had happened.
   */
  it("a later declaration un-clears it, so a fresh answer is heard", async () => {
    const { db, shop, person } = await stamped();
    const staff = await staffOf(db, shop.id);
    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: staff.id,
    });

    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      noCertification: true,
    });

    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.noCertificationClearedAt).toBeNull();
    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);
    expect(profiles.get(person.id)?.noCertificationDeclared).toBe(true);
  });

  /**
   * The half of that which an **unauthenticated** caller must not be able to
   * reach. `recordSelfDeclaredCards` is posted to by two public forms, and the
   * fact it is writing next to is one a member of staff authored. If a fresh
   * declaration cleared *both* columns, an anonymous poster who knows a diver's
   * name and email could loop the stamp back on with nothing left saying a
   * staffer had ever disagreed — the same shape as the 2026-08-14 anonymous
   * mutation of a staff-authored field this ADR records, one column over.
   */
  it("a later declaration cannot erase who corrected it", async () => {
    const { db, shop, person } = await stamped();
    const staff = await staffOf(db, shop.id);
    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: staff.id,
    });

    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      noCertification: true,
    });

    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    // Set, with a null `clearedAt` beside it: *corrected once, and stated again
    // since*. Both facts survive, and the reader still needs only the null test.
    expect(row?.noCertificationClearedByPersonId).toBe(staff.id);
  });

  it("can be cleared again after a re-declaration, recording the staffer who did it", async () => {
    const { db, shop, person } = await stamped();
    const first = await staffOf(db, shop.id);
    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: first.id,
    });
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      noCertification: true,
    });
    const { person: second } = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Sam Ortiz",
      email: "sam@example.com",
    });

    const again = await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: person.id,
      byPersonId: second.id,
    });

    expect(again).toBe(true);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.noCertificationClearedByPersonId).toBe(second.id);
    const profiles = await listCertificationSummaries(db, shop.id, [person.id]);
    expect(profiles.get(person.id)).toBeUndefined();
  });
});

/**
 * `certifications_identifier_present_unless_self_declared` was credited, in
 * three comments and the ADR, with keeping a numberless row out of `verified`.
 * It read `identifier is not null`, and `''` satisfies that — so the claim was
 * true of NULL and held up by the application alone for the empty string.
 */
describe("the card-number constraint", () => {
  /**
   * The regression the tightening itself introduced for one afternoon, caught by
   * a `dive-domain-expert` and a `security-reviewer` pass independently.
   *
   * A CHECK passes when its expression is TRUE **or NULL**, and
   * `length(btrim(NULL)) > 0` is NULL — so a predicate written as
   * `length(...) > 0 or (…)` evaluated to `NULL OR FALSE` = NULL on a numberless
   * `verified` row and *accepted* it, which is weaker than the
   * `identifier is not null or (…)` it was supposed to be tightening. Both
   * conjuncts are load-bearing; this test is the one that says so.
   */
  it("refuses a null card number on a verified row — a CHECK is satisfied by NULL", async () => {
    const { db, shop, person } = await joiner();

    await expect(
      db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "instructor",
        identifier: null,
        status: "verified",
      }),
    ).rejects.toThrow();
  });

  it("refuses a null card number on a verified nitrox row too", async () => {
    const { db, shop, person } = await joiner();

    await expect(
      db.insert(nitroxCertifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        identifier: null,
        status: "verified",
      }),
    ).rejects.toThrow();
  });

  it("refuses a null card number on a self-declared row the moment it is verified", async () => {
    const { db, shop, person } = await joiner();
    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: person.id,
      level: "instructor",
    });
    // This diver's row specifically — `liveCards` is shop-wide and the seeded
    // shop's own divers hold real numbered cards, whose promotion is legal.
    const [claim] = (await liveCards(db, shop.id)).filter((row) => row.personId === person.id);
    if (!claim) throw new Error("self-declaration wrote no card");

    // The exact escalation the constraint exists to make impossible: a claim
    // promoted to `verified` with no number behind it. `reviewCertification`
    // refuses this too — the point is that the database does as well, so the
    // refusal does not depend on one action remembering to ask.
    await expect(
      db.update(certifications).set({ status: "verified" }).where(eq(certifications.id, claim.id)),
    ).rejects.toThrow();
  });

  it("refuses a blank card number on a verified row, not merely a null one", async () => {
    const { db, shop, person } = await joiner();

    await expect(
      db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: "   ",
        status: "verified",
      }),
    ).rejects.toThrow();
  });

  // Bare `btrim()` strips spaces and nothing else, so a lone tab used to satisfy
  // it. Unreachable from the app (`cardNumberSchema` trims in JS and demands a
  // digit) — but this constraint is the backstop, and a backstop that only holds
  // when the layer above it already did is not one.
  it("refuses whitespace that is not a space", async () => {
    const { db, shop, person } = await joiner();

    await expect(
      db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: "\t\n",
        status: "verified",
      }),
    ).rejects.toThrow();
  });

  it("still lets a self-declared row carry no number at all", async () => {
    const { db, shop, person } = await joiner();

    await expect(
      db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "other",
        level: "open_water",
        identifier: null,
        status: "pending",
        selfDeclaredAt: nowDate(),
      }),
    ).resolves.toBeDefined();
  });
});
