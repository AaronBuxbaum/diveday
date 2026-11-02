import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { createCourseForm, listCourseForms } from "@/db/course-forms";
import { courseForms, shops } from "@/db/schema";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * The waiver template is the shop's legal instrument: whatever text is current
 * here is what every diver signs, and what the shop would produce if a release
 * were ever tested. Editing it is owner/manager work (H-20260724-staff-role-reach, ADR
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
const { deleteCourseFormAction, saveCourseFormAction, saveWaiverAction } = await import(
  "./actions"
);
const { RELEASE_FORM_IDLE } = await import("./release-form-state");

/** Long enough to clear the 40-character minimum the schema enforces. */
const NEW_BODY = "Rewritten release text posted by someone who should not be able to publish it.";

async function context() {
  const { db, shop } = ctx;
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

describe("publishing a waiver template", () => {
  it("refuses a captain, and the text divers sign is unchanged", async () => {
    const { db, shop, captain } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, captain);

    const to = await redirectedTo(() => saveWaiverAction(RELEASE_FORM_IDLE, withBody(NEW_BODY)));

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

    const to = await redirectedTo(() => saveWaiverAction(RELEASE_FORM_IDLE, withBody(NEW_BODY)));

    expect(to).toBe(`/shop/${shop.slug}?notice=waivers-not-authorized`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("lets an owner publish a new version", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => saveWaiverAction(RELEASE_FORM_IDLE, withBody(NEW_BODY)));

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

    const to = await redirectedTo(() =>
      saveWaiverAction(RELEASE_FORM_IDLE, withBody(NEW_BODY, "non-material")),
    );

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

    const to = await redirectedTo(() =>
      saveWaiverAction(RELEASE_FORM_IDLE, withBody(before?.body ?? "")),
    );

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=waiver-unchanged`);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("publishes a questions-only edit as a new version, with the same body", async () => {
    const { db, shop, owner } = await context();
    const before = await getCurrentWaiverTemplate(db, shop.id);
    if (!before) throw new Error("seeded template missing");
    signIn(shop, owner);
    const formData = withBody(before.body, "non-material");
    const questions = [
      { id: "insurance01", kind: "yes_no", prompt: "Do you carry DAN insurance?", required: true },
    ];
    formData.set("questions", JSON.stringify(questions));

    const to = await redirectedTo(() => saveWaiverAction(RELEASE_FORM_IDLE, formData));

    expect(to).toBe(`/shop/${shop.slug}/waivers?notice=saved`);
    const after = await getCurrentWaiverTemplate(db, shop.id);
    expect(after?.version).toBe(before.version + 1);
    expect(after?.body).toBe(before.body);
    expect(after?.questions).toEqual(questions);
    expect(after?.materialGeneration).toBe(before.materialGeneration);
  });

  it("refuses a question list the server cannot read, without touching the current version", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);
    for (const questions of [
      "not json",
      JSON.stringify([{ id: "bad id", kind: "yes_no", prompt: "Insured?", required: false }]),
      JSON.stringify([
        { id: "choice00001", kind: "choice", prompt: "Pick", required: false, options: ["One"] },
      ]),
    ]) {
      const formData = withBody(NEW_BODY);
      formData.set("questions", questions);
      expect(await saveWaiverAction(RELEASE_FORM_IDLE, formData)).toMatchObject({
        status: "refused",
        refusal: "questions",
      });
    }
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  // Dive-domain review 2, S2: a refused publish hands back everything typed,
  // and names the question it refused.
  it("hands a refused list back with the text and the question it refused", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);
    const formData = withBody(NEW_BODY, "non-material");
    const nine = Array.from({ length: 9 }, (_, i) => `Option ${i + 1}`);
    const questions = [
      { id: "insurance01", kind: "yes_no", prompt: "Insured?", required: true },
      { id: "heardabout1", kind: "choice", prompt: "Heard of us?", required: false, options: nine },
    ];
    formData.set("questions", JSON.stringify(questions));

    expect(await saveWaiverAction(RELEASE_FORM_IDLE, formData)).toEqual({
      status: "refused",
      refusal: "questions",
      questionNumber: 2,
      typed: { body: NEW_BODY, questions, material: "non-material" },
    });
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  // Security review M2: a list field longer than any real list is refused
  // before it is parsed, and quickly.
  it("refuses a huge question list unread", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);
    const formData = withBody(NEW_BODY);
    const options = Array.from({ length: 150_000 }, (_, i) => String(i));
    formData.set(
      "questions",
      JSON.stringify([
        { id: "heardabout1", kind: "choice", prompt: "x", required: false, options },
      ]),
    );
    const started = performance.now();
    expect(await saveWaiverAction(RELEASE_FORM_IDLE, formData)).toMatchObject({
      status: "refused",
      refusal: "questions",
      typed: { questions: null },
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("refuses a body too short to be a release, without touching the current one", async () => {
    const { db, shop, owner } = await context();
    const before = await currentTemplate(db, shop.id);
    signIn(shop, owner);

    expect(await saveWaiverAction(RELEASE_FORM_IDLE, withBody("Too short."))).toMatchObject({
      status: "refused",
      refusal: "body",
      typed: { body: "Too short." },
    });
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  /**
   * **The server half of "no submit without a choice"** (ADR
   * 20260827-people-not-lists, decision 4; H-20260822-may-shop-explicitly-declare's two explicit choices).
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

    expect(await saveWaiverAction(RELEASE_FORM_IDLE, formData)).toMatchObject({
      status: "refused",
      refusal: "materiality",
      typed: { body: NEW_BODY, material: null },
    });
    expect(await currentTemplate(db, shop.id)).toEqual(before);
  });

  it("tells that refusal apart from a release too short to be one", async () => {
    const { shop, owner } = await context();
    signIn(shop, owner);
    const noChoice = new FormData();
    noChoice.set("body", NEW_BODY);

    const tooShort = await saveWaiverAction(RELEASE_FORM_IDLE, withBody("Too short."));
    const unstated = await saveWaiverAction(RELEASE_FORM_IDLE, noChoice);

    // The inequality is the pin, not either refusal on its own: a staffer
    // reads the line beside Publish, and one refusal renders one sentence.
    expect(unstated.status === "refused" && unstated.refusal).toBe("materiality");
    expect(tooShort.status === "refused" && tooShort.refusal).toBe("body");
  });
});

/**
 * Course forms are the shop's legal instruments too (ADR 20261008-course-forms):
 * the words a student signs before a course. The same owner/manager gate, run
 * inside each action, where a POST that skipped the page still lands.
 */
describe("writing a course form", () => {
  const FORM_BODY =
    "Placeholder course form text. Replace it with your own form before you use it.";

  /** The live form by that title — the demo shop may hold others. */
  async function formTitled(db: AppDb, shopId: string, title: string) {
    return (await listCourseForms(db, shopId)).find((form) => form.title === title);
  }

  function formPost(fields: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    return formData;
  }

  it("refuses a captain, and writes no form", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      saveCourseFormAction(formPost({ title: "Course release", body: FORM_BODY })),
    );

    expect(to).toBe(`/shop/${shop.slug}?notice=waivers-not-authorized`);
    expect(await formTitled(db, shop.id, "Course release")).toBeUndefined();
  });

  it("lets an owner add a form, and lands on that form", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveCourseFormAction(formPost({ title: "Course release", body: FORM_BODY })),
    );

    const form = await formTitled(db, shop.id, "Course release");
    expect(form).toMatchObject({ title: "Course release", version: 1 });
    expect(to).toBe(
      `/shop/${shop.slug}/waivers?notice=course-form-saved&form=${form?.id}#course-form-${form?.id}`,
    );
  });

  it("says 'unchanged' and writes no version when nothing changed", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const created = await createCourseForm(db, {
      shopId: shop.id,
      title: "Course release",
      body: FORM_BODY,
      actorPersonId: owner,
    });

    const to = await redirectedTo(() =>
      saveCourseFormAction(
        formPost({ formId: created.id, title: "Course release", body: FORM_BODY }),
      ),
    );

    expect(to).toContain("notice=course-form-unchanged");
    expect((await formTitled(db, shop.id, "Course release"))?.version).toBe(1);
  });

  /**
   * The medical statement marker is the form's identity, not its words (#2337):
   * a post that names nothing about it leaves it alone, and only the form's own
   * hidden "unmarked" value, with the box unticked, clears it.
   */
  it("keeps the medical marker when the post names none, and clears it only when told", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const created = await createCourseForm(db, {
      shopId: shop.id,
      title: "Course release",
      body: FORM_BODY,
      actorPersonId: owner,
      medicalScreening: true,
    });
    const marked = async () =>
      (await listCourseForms(db, shop.id)).find((form) => form.id === created.id)?.medicalScreening;
    const post = (...extra: string[]) => {
      const formData = formPost({ formId: created.id, title: "Course release", body: FORM_BODY });
      for (const value of extra) formData.append("medicalScreening", value);
      return formData;
    };

    await redirectedTo(() => saveCourseFormAction(post()));
    expect(await marked()).toBe(true);

    await redirectedTo(() => saveCourseFormAction(post("unmarked", "on")));
    expect(await marked()).toBe(true);

    await redirectedTo(() => saveCourseFormAction(post("unmarked")));
    expect(await marked()).toBe(false);

    await redirectedTo(() => saveCourseFormAction(post("unmarked", "on")));
    expect(await marked()).toBe(true);
  });

  it("refuses a form too short to be one, beside the new-form box", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveCourseFormAction(formPost({ title: "Course release", body: "Too short." })),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/waivers?notice=course-form-invalid&form=new#course-form-new`,
    );
    expect(await formTitled(db, shop.id, "Course release")).toBeUndefined();
  });

  it("will not version another shop's form", async () => {
    const { db, shop, owner } = await context();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-forms", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const foreign = await createCourseForm(db, {
      shopId: other.id,
      title: "Their form",
      body: FORM_BODY,
      actorPersonId: owner,
    });
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveCourseFormAction(
        formPost({ formId: foreign.id, title: "Hijacked", body: `${FORM_BODY} Changed.` }),
      ),
    );

    expect(to).toContain("notice=course-form-not-found");
    const [theirs] = await listCourseForms(db, other.id);
    expect(theirs).toMatchObject({ title: "Their form", version: 1 });
  });

  it("refuses a captain's delete, and an owner's delete is soft", async () => {
    const { db, shop, owner, captain } = await context();
    const created = await createCourseForm(db, {
      shopId: shop.id,
      title: "Course release",
      body: FORM_BODY,
      actorPersonId: owner,
    });

    signIn(shop, captain);
    const refused = await redirectedTo(() =>
      deleteCourseFormAction(formPost({ formId: created.id })),
    );
    expect(refused).toBe(`/shop/${shop.slug}?notice=waivers-not-authorized`);
    expect(await formTitled(db, shop.id, "Course release")).toBeDefined();

    signIn(shop, owner);
    const deleted = await redirectedTo(() =>
      deleteCourseFormAction(formPost({ formId: created.id })),
    );
    expect(deleted).toBe(
      `/shop/${shop.slug}/waivers?notice=course-form-deleted&form=list#course-forms`,
    );
    expect(await formTitled(db, shop.id, "Course release")).toBeUndefined();
    const [row] = await db
      .select({ deletedAt: courseForms.deletedAt })
      .from(courseForms)
      .where(eq(courseForms.id, created.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});
