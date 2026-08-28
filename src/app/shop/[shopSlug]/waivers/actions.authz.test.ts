import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The waiver template is the shop's legal instrument: whatever text is current
 * here is what every diver signs, and what the shop would produce if a release
 * were ever tested. Editing it is owner/manager work (H-14, ADR
 * 20260724-role-authorization) and the page doesn't exist for anyone else
 * (20260724-role-gated-surfaces-hide-not-explain) — but a page that redirects is
 * not a gate, and until this action moved out of its inline `"use server"`
 * closure there was no way to post at it without the page (ADR-0006).
 *
 * `saveWaiverTemplate` has no re-check of its own: it writes the version it is
 * handed. The gate line in `./actions.ts` is the only thing between a captain
 * and the text divers sign, so these tests assert the refusal *and* that the
 * current template is untouched behind it.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { saveWaiverAction } = await import("./actions");

/** Long enough to clear the 40-character minimum the schema enforces. */
const NEW_BODY = "Rewritten release text posted by someone who should not be able to publish it.";

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function withBody(body: string, material: "material" | "non-material" = "material") {
  const formData = new FormData();
  formData.set("body", body);
  formData.set("material", material);
  return formData;
}

/** The version divers would sign right now — text and version number. */
async function currentTemplate(db: AppDb, shopId: string) {
  const template = await getCurrentWaiverTemplate(db, shopId);
  return template
    ? { title: template.title, body: template.body, version: template.version }
    : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishing a waiver template", () => {
  it("refuses a captain, and the text divers sign is unchanged", async () => {
    const { db, shop, captain } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, captain);

    const to = await redirectedTo(() => saveWaiverAction(withBody(NEW_BODY)));

    // Bounced to Today, not to a read-only copy of the release: the surface
    // doesn't exist for this role at all.
    expect(to).toBe(`/shop/${shop.slug}?notice=waivers-not-authorized`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("refuses a captain whose session claims to be an owner", async () => {
    // A JWT's roles are minted at sign-in, so they can be stale or forged. Sal
    // is a captain in `person_roles` whatever the token says, and the gate reads
    // `person_roles`.
    const { db, shop, captain } = await context();
    const before = await currentTemplate(db, shop.id);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: shop.id,
        shopSlug: shop.slug,
        personId: captain,
        roles: ["owner", "manager"],
      }),
    );

    const to = await redirectedTo(() => saveWaiverAction(withBody(NEW_BODY)));

    expect(to).toBe(`/shop/${shop.slug}?notice=waivers-not-authorized`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("lets an owner publish a new version", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => saveWaiverAction(withBody(NEW_BODY)));

    // Not a bare "saved": the demo shop holds signed releases against the
    // version this just replaced, and every one of them stops counting the
    // instant it lands. The staffer is told how many rather than walking away
    // believing nothing happened (issue #720).
    expect(to).toMatch(
      new RegExp(`^/shop/${shop.slug}/waivers\\?notice=waiver-resigning&count=[1-9]\\d*$`),
    );
    const after = await currentTemplate(db, shop.id);
    expect(after?.body).toBe(NEW_BODY);
    // A new version, never an edit in place — the old text stays evidence of
    // what earlier signatures were given against.
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    // ...and the shop's own name for its release survives the edit.
    expect(after?.title).toBe(before?.title);
  });

  it("lets an owner publish a non-material version without forcing resigning", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => saveWaiverAction(withBody(NEW_BODY, "non-material")));

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=saved`);
    const after = await currentTemplate(db, shop.id);
    expect(after?.body).toBe(NEW_BODY);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(after?.title).toBe(before?.title);
  });

  it("publishes nothing when the body has not changed, and does not say 'saved'", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => saveWaiverAction(withBody(before?.body ?? "")));

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=waiver-unchanged`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("refuses a body too short to be a release, without touching the current one", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => saveWaiverAction(withBody("Too short.")));

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=invalid`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  /**
   * **The server half of "no submit without a choice"** (ADR
   * 20260827-people-not-lists, decision 4; H-54's two explicit choices).
   *
   * The surface asks with a radio pair the form is invalid without
   * (`_components/PublishRelease.tsx`), but a form gate is a render-time gate:
   * a POST straight at the action never met it (ADR-0006). Publishing the
   * wrong materiality is not a cosmetic error — it decides whether the whole
   * shop signs again — so the action refuses a submission that names neither,
   * rather than defaulting to one of them on the shop's behalf.
   *
   * **And it says so in its own words.** This refusal shared the `invalid` code
   * with the too-short one above until 2026-08-28, and so inherited its
   * sentence — "the release needs to be at least a few sentences long". The
   * staffer meeting it has shortened nothing: a material publish leaves zero
   * standing signatures, so the tab they are looking at drew no radios at all,
   * and once divers have signed the new release a second publish from that same
   * tab posts no `material` field. They were told to lengthen a release they
   * never touched, with nothing on the screen to act on. Two refusals, two
   * codes.
   */
  it("refuses a publish that calls the edit neither thing, while signatures stand", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("body", NEW_BODY);

    const to = await redirectedTo(() => saveWaiverAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=waiver-materiality-required`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("tells that refusal apart from a release too short to be one", async () => {
    const { shop, owner } = await context();
    signIn(shop, owner);
    const noChoice = new FormData();
    noChoice.set("body", NEW_BODY);

    const tooShort = await redirectedTo(() => saveWaiverAction(withBody("Too short.")));
    const unstated = await redirectedTo(() => saveWaiverAction(noChoice));

    // The inequality is the pin, not either code on its own: a staffer reads
    // the banner, and one code can only ever render one sentence.
    expect(unstated).not.toBe(tooShort);
    expect(unstated).not.toContain("notice=invalid");
  });
});
