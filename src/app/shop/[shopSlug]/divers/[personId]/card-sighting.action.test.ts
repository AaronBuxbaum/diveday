import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { certifications, nitroxCertifications, people } from "@/db/schema";
import { recordSelfDeclaredCards } from "@/db/self-declared-cards";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **What the diver record says when a card sighting is refused.**
 *
 * A sighting is the one moment a stranger's typing becomes `verified` — the
 * state readiness, trip admission, every course prerequisite and the nitrox fill
 * gate read (ADR 20260814-self-declared-cards). Everything here is about the
 * *refusals*, because the refusals are what a busy staffer routes around: a
 * refused card **number** used to arrive as `card_sighting_required` — *"Enter
 * the agency and number from the card in front of you"* — to somebody who had
 * just done exactly that. The way past that sentence is to delete the claim and
 * capture the same bad number by hand, which reaches the identical `verified`
 * state with `self_declared_at` thrown away.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { notFound } = await import("next/navigation");
const {
  clearNoCertificationAction,
  deleteCertificationAction,
  reviewAction,
  reviewSpecialtyAction,
} = await import("./actions");

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Declared Della", email: "della@example.com" })
    .returning();
  if (!person) throw new Error("failed to insert a diver");
  return { db, shop, personId: person.id };
}

/** A diver's own typed claim — the only row a sighting form ever certifies. */
async function claimedLevel(db: AppDb, shopId: string, personId: string) {
  await recordSelfDeclaredCards(db, { shopId, personId, level: "instructor" });
  const [card] = await db
    .select()
    .from(certifications)
    .where(eq(certifications.personId, personId));
  if (!card) throw new Error("self-declaration wrote no card");
  return card;
}

async function claimedNitrox(db: AppDb, shopId: string, personId: string) {
  await recordSelfDeclaredCards(db, { shopId, personId, nitrox: true });
  const [card] = await db
    .select()
    .from(nitroxCertifications)
    .where(eq(nitroxCertifications.personId, personId));
  if (!card) throw new Error("self-declaration wrote no nitrox card");
  return card;
}

function sighting(certificationId: string, fields: Record<string, string>) {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the diver-record action subject", () => {
  it("404s a malformed bound person id before any session or database read", async () => {
    await expect(reviewAction("blue-mantis", "not-a-uuid", new FormData())).rejects.toThrow(
      "NOT_FOUND",
    );

    expect(notFound).toHaveBeenCalledOnce();
    expect(requireStaffSession).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("a card sighting whose number is not a card number", () => {
  it("says so on the number's own box, rather than asking for what was just typed", async () => {
    const { db, shop, personId } = await context();
    const card = await claimedLevel(db, shop.id, personId);

    const to = await redirectedTo(() =>
      reviewAction(
        shop.slug,
        personId,
        sighting(card.id, {
          sightedAgency: "padi",
          sightedLevel: "open_water",
          sightedIdentifier: "xx",
        }),
      ),
    );

    // Its own code, not `card-sighting-required`. `NoticeBanner` maps it to the
    // `sighted-identifier` field, so the sighting form re-opens with the error
    // on the box that was wrong.
    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=card-number-implausible&form=cards#certifications`,
    );
    // And nothing was written: the claim is still a claim.
    const [after] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(after?.status).toBe("pending");
    expect(after?.level).toBe("instructor");
    expect(after?.identifier).toBeNull();
    expect(after?.reviewedAt).toBeNull();
  });

  it("refuses the nitrox twin the same way — that tap authorizes a gas fill", async () => {
    const { db, shop, personId } = await context();
    const card = await claimedNitrox(db, shop.id, personId);

    const to = await redirectedTo(() =>
      reviewSpecialtyAction(
        shop.slug,
        personId,
        sighting(card.id, {
          cardType: "nitrox",
          sightedAgency: "padi",
          sightedIdentifier: "ok",
        }),
      ),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=card-number-implausible&form=cards#certifications`,
    );
    const [after] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, card.id));
    expect(after?.status).toBe("pending");
    expect(after?.identifier).toBeNull();
  });

  it("still certifies a number that looks like one — the check is a typo filter, not a gate on real cards", async () => {
    const { db, shop, personId } = await context();
    const card = await claimedLevel(db, shop.id, personId);

    const to = await redirectedTo(() =>
      reviewAction(
        shop.slug,
        personId,
        sighting(card.id, {
          sightedAgency: "ssi",
          sightedLevel: "open_water",
          sightedIdentifier: "SSI-4471",
        }),
      ),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=verified&form=cards#certifications`,
    );
    const [after] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(after?.status).toBe("verified");
    expect(after?.identifier).toBe("SSI-4471");
    // The rung the staffer read off the card, never the diver's own claim.
    expect(after?.level).toBe("open_water");
  });

  /**
   * The other half of the same seam: a sighting that malforms some *other*
   * field collapses to `undefined` rather than a partial object, so nothing is
   * half-written from it. It keeps the generic refusal, which is honest — the
   * staffer typed a number, and the number is not what was wrong.
   */
  it("writes nothing at all from a sighting whose level is not on the ladder", async () => {
    const { db, shop, personId } = await context();
    const card = await claimedLevel(db, shop.id, personId);

    const to = await redirectedTo(() =>
      reviewAction(
        shop.slug,
        personId,
        sighting(card.id, {
          sightedAgency: "padi",
          sightedLevel: "grand_master",
          sightedIdentifier: "PADI-99887",
        }),
      ),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=card-sighting-required&form=cards#certifications`,
    );
    const [after] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    // Not the posted agency, not the posted number, not `verified`: a partial
    // object here would be a card half-transcribed from a form nobody finished.
    expect(after?.status).toBe("pending");
    expect(after?.agency).toBe("other");
    expect(after?.identifier).toBeNull();
    expect(after?.level).toBe("instructor");
  });
});

/**
 * `certificationId` goes straight into `eq(certifications.id, …)`. Postgres does
 * not coerce a malformed uuid literal — it raises — so each of these was a 500
 * where the action's own refusal belongs one line later.
 */
describe("a card id that is not a uuid", () => {
  it("refuses the review instead of raising", async () => {
    const { shop, personId } = await context();

    const to = await redirectedTo(() =>
      reviewAction(shop.slug, personId, sighting("../../etc", {})),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=invalid&form=cards#certifications`,
    );
  });

  it("refuses the delete instead of raising", async () => {
    const { shop, personId } = await context();

    const to = await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, sighting("42", {})),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=invalid&form=cards#certifications`,
    );
  });

  it("refuses the specialty review instead of raising", async () => {
    const { shop, personId } = await context();

    const to = await redirectedTo(() =>
      reviewSpecialtyAction(shop.slug, personId, sighting("nope", { cardType: "nitrox" })),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=invalid&form=cards#certifications`,
    );
  });
});

/**
 * The eraser for a *"Not certified yet — diver's word"* stamp two
 * unauthenticated forms can leave on any diver the shop holds no card for.
 */
describe("clearing a wrong 'not certified yet'", () => {
  it("clears it, and cannot certify anything on the way", async () => {
    const { db, shop, personId } = await context();
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, noCertification: true });

    const to = await redirectedTo(() =>
      clearNoCertificationAction(shop.slug, personId, new FormData()),
    );

    // Page-level, deliberately: the panel holding the control renders only
    // while the stamp is set, so a successful clear unmounts it.
    expect(to).toBe(`/shop/${shop.slug}/divers/${personId}?notice=no-certification-cleared`);
    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect(row?.noCertificationClearedAt).not.toBeNull();
    // Superseded rather than deleted — where a record began is history.
    expect(row?.noCertificationDeclaredAt).not.toBeNull();
    // And no card came into existence anywhere.
    expect(
      await db.select().from(certifications).where(eq(certifications.personId, personId)),
    ).toHaveLength(0);
  });

  /**
   * A double tap or a replayed submit **succeeded** — the record already says
   * what the staffer wanted — so it is neither a fresh success (which would put
   * their name on an act that did not happen) nor the generic `invalid`, whose
   * copy is *"Check the details and try again"* in a danger tone and reads as
   * "your correction failed."
   */
  it("reports nothing to clear rather than a correction that did not happen", async () => {
    const { shop, personId } = await context();

    const to = await redirectedTo(() =>
      clearNoCertificationAction(shop.slug, personId, new FormData()),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=no-certification-nothing-to-clear`,
    );
  });

  /**
   * The gate is deliberately every staff role — this is weaker than capturing a
   * card, and H-48 is the open question about who may *sight* one. What it is
   * not is JWT-only: an account since demoted, removed or disabled must stop
   * overriding a diver's own statement, and `requireStaffSession` cannot see
   * that from the token alone.
   */
  it("refuses an account that is no longer active staff at this shop", async () => {
    const { db, shop, personId } = await context();
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, noCertification: true });
    // A valid-looking session for somebody holding no live role here at all.
    const [stranger] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "No Longer Staff Nate", email: "nate@example.com" })
      .returning();
    if (!stranger) throw new Error("failed to insert a person");
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: stranger.id }),
    );

    const to = await redirectedTo(() =>
      clearNoCertificationAction(shop.slug, personId, new FormData()),
    );

    expect(to).toBe(`/shop/${shop.slug}/divers/${personId}?notice=not-authorized-cards`);
    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect(row?.noCertificationClearedAt).toBeNull();
  });

  /**
   * The asymmetry that mattered more than the one above, and it ran backwards
   * for an afternoon: the *weakest* act on this page re-read live roles while
   * the strongest ones did not. A sighting is the single moment a stranger's
   * typing becomes `verified` — the state readiness, `decideTripAdmission`,
   * every course prerequisite, the depth advisory and the nitrox fill gate all
   * read — so a revoked account holding a live token could still do it.
   */
  it("refuses a revoked account the sighting itself, not just the eraser", async () => {
    const { db, shop, personId } = await context();
    const card = await claimedLevel(db, shop.id, personId);
    const [stranger] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Revoked Rae", email: "rae@example.com" })
      .returning();
    if (!stranger) throw new Error("failed to insert a person");
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: stranger.id }),
    );

    const to = await redirectedTo(() =>
      reviewAction(
        shop.slug,
        personId,
        sighting(card.id, {
          sightedAgency: "ssi",
          sightedLevel: "open_water",
          sightedIdentifier: "SSI-4471",
        }),
      ),
    );

    expect(to).toBe(`/shop/${shop.slug}/divers/${personId}?notice=not-authorized-cards`);
    const [after] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(after?.status).toBe("pending");
    expect(after?.identifier).toBeNull();
  });
});
