"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { createCourseForm, deleteCourseForm, saveCourseFormVersion } from "@/db/course-forms";
import { saveWaiverTemplate, standingWaiverExposure } from "@/db/waivers";
import {
  COURSE_FORM_BODY_MAX,
  COURSE_FORM_BODY_MIN,
  COURSE_FORM_TITLE_MAX,
} from "@/lib/course-forms";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const templateSchema = z.object({
  body: z.string().trim().min(40).max(12_000),
});

/**
 * Publish a new version of the shop's waiver — its legal instrument, and the
 * text every diver signs from here on.
 *
 * The page's own module rather than an inline `"use server"` closure (AGENTS.md
 * layout rule for a large page) so the gate below can be exercised on its own:
 * an inline closure is only reachable through the page that renders it, which is
 * exactly the layer a POST straight at the action skips. The gate stays *inside*
 * the action for that reason — the page's own check guards the render, this one
 * guards the write (ADR-0006). See `./actions.authz.test.ts`.
 */
export async function saveWaiverAction(formData: FormData) {
  const staff = await requireStaffSession();
  const editor = await getDb();
  if (!(await canPersonManageWaiverTemplates(editor, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(shopPath(staff.user.shopSlug), "waivers-not-authorized"));
  }
  const waivers = shopPath(staff.user.shopSlug, "waivers");
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(waivers, "invalid"));
  // Counted *before* the save, because after it the number is zero by
  // construction: the new version is current and nothing is signed against it
  // yet. This is the same act `saveRequirementsAction` performs for one
  // departure — "here is who that just blocked" — and the reason it exists
  // there applies with the whole shop's roster behind it.
  const atRisk = await standingWaiverExposure(editor, staff.user.shopId);
  // No title: this form has no field for one, so a save cannot mean "rename"
  // and `saveWaiverTemplate` carries the shop's own forward.
  //
  // H-54's two explicit choices, enforced where a POST cannot skip them. The
  // surface asks with a radio pair the form is invalid without
  // (`./_components/PublishRelease.tsx`, ADR 20260827-people-not-lists), but
  // that is a render-time gate on an action reachable without it — and
  // defaulting a missing answer either way would decide, on the shop's behalf,
  // whether its whole roster signs again.
  const materialValue = formData.get("material");
  if (atRisk.divers > 0 && materialValue !== "material" && materialValue !== "non-material") {
    // Its **own** code, never the `invalid` above. That one renders "the
    // release needs to be at least a few sentences long", and this refusal is
    // not about the text: an owner told to lengthen a release they never
    // shortened has been handed the wrong problem, and nothing on the screen
    // would tell them otherwise.
    //
    // Nor is this an adversary-only path. A material publish bumps
    // `materialGeneration`, so the very next render counts zero standing
    // signatures and `PublishRelease` draws no radios at all; divers then sign
    // the new release over the following minutes. The staffer who spots a typo
    // and publishes again *from that same tab* posts no `material` field, and
    // lands here. `revalidateAndRedirect` rather than a bare `redirect` for
    // that reason — the destination render is what finally puts the choice on
    // screen, so it must not be served from the cached segment that had none.
    revalidateAndRedirect(waivers, noticeUrl(waivers, "waiver-materiality-required"));
  }
  const isMaterial = materialValue !== "non-material";
  const { versioned } = await saveWaiverTemplate(editor, {
    shopId: staff.user.shopId,
    body: parsed.data.body,
    material: isMaterial,
    actorPersonId: staff.user.personId,
  });
  if (!versioned) {
    // Nothing was written, so "Saved" would be a lie in the one direction that
    // matters: it would teach a staffer that pressing Save is free.
    revalidateAndRedirect(waivers, noticeUrl(waivers, "waiver-unchanged"));
  }
  revalidateAndRedirect(
    waivers,
    atRisk.divers > 0 && isMaterial
      ? noticeUrl(waivers, "waiver-resigning", { count: atRisk.divers })
      : noticeUrl(waivers, "saved"),
  );
}

const courseFormSchema = z.object({
  formId: z.uuid().optional(),
  title: z.string().trim().min(2).max(COURSE_FORM_TITLE_MAX),
  body: z.string().trim().min(COURSE_FORM_BODY_MIN).max(COURSE_FORM_BODY_MAX),
});

/**
 * Write a course form (ADR 20261008-course-forms): a new one when no `formId`
 * is posted, a new version of an existing one otherwise. Owner or manager,
 * like the release — a course form is the shop's legal instrument too — and
 * re-checked here, where a POST that skipped the page still lands.
 *
 * The outcome comes back beside the form it was about (`?form=`), on the
 * form's own anchor, rather than at the top of a page that leads with the
 * signature log.
 */
export async function saveCourseFormAction(formData: FormData) {
  const staff = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageWaiverTemplates(db, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(shopPath(staff.user.shopSlug), "waivers-not-authorized"));
  }
  const waivers = shopPath(staff.user.shopSlug, "waivers");
  const postedId = String(formData.get("formId") ?? "");
  const anchorFor = (id: string) => `${waivers}#course-form-${id}`;
  const parsed = courseFormSchema.safeParse({
    formId: postedId || undefined,
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) {
    // A malformed id is no form at all: the refusal lands on the new-form box.
    const target = z.uuid().safeParse(postedId).success ? postedId : "new";
    redirect(noticeUrl(anchorFor(target), "course-form-invalid", { form: target }));
  }
  const formId = parsed.data.formId;
  if (!formId) {
    const created = await createCourseForm(db, {
      shopId: staff.user.shopId,
      title: parsed.data.title,
      body: parsed.data.body,
      actorPersonId: staff.user.personId,
    });
    revalidateAndRedirect(
      waivers,
      noticeUrl(anchorFor(created.id), "course-form-saved", { form: created.id }),
    );
    return;
  }
  const saved = await saveCourseFormVersion(db, {
    shopId: staff.user.shopId,
    formId,
    title: parsed.data.title,
    body: parsed.data.body,
    actorPersonId: staff.user.personId,
  });
  const code = !saved.ok
    ? "course-form-not-found"
    : saved.versioned
      ? "course-form-saved"
      : "course-form-unchanged";
  revalidateAndRedirect(waivers, noticeUrl(anchorFor(formId), code, { form: formId }));
}

/**
 * Delete a course form (soft). Every course that asked for it stops asking;
 * the records students already signed stay on file with the words they signed.
 */
export async function deleteCourseFormAction(formData: FormData) {
  const staff = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageWaiverTemplates(db, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(shopPath(staff.user.shopSlug), "waivers-not-authorized"));
  }
  const waivers = shopPath(staff.user.shopSlug, "waivers");
  const formId = z.uuid().safeParse(formData.get("formId"));
  const deleted = formId.success
    ? await deleteCourseForm(db, { shopId: staff.user.shopId, formId: formId.data })
    : false;
  revalidateAndRedirect(
    waivers,
    noticeUrl(
      `${waivers}#course-forms`,
      deleted ? "course-form-deleted" : "course-form-not-found",
      {
        form: "list",
      },
    ),
  );
}
