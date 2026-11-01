"use server";

import { revalidatePath } from "next/cache";
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
import { blankAsAbsent, formValue, parseForm, readForm, single, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { readPostedShopQuestions, type ShopQuestion } from "@/lib/waiver-questions";
import {
  type ReleaseFormRefusal,
  type ReleaseFormState,
  typedShopQuestions,
} from "./release-form-state";

const templateSchema = z.object({
  body: z.string().trim().min(40).max(12_000),
});

/**
 * The editor's "Your questions" list, posted as one JSON field and read by
 * `readPostedShopQuestions`, the rule of record: refused unread above its
 * length cap (security review M2), then `parseShopQuestions`. Absent (a POST
 * that never met the editor) carries the current list forward, as the title
 * does; present and unreadable is a refusal, never a silent empty list that
 * would publish a version asking nothing.
 */
function readQuestions(
  formData: FormData,
): { ok: true; questions?: ShopQuestion[] } | { ok: false; questionNumber?: number } {
  const raw = formData.get("questions");
  if (raw === null) return { ok: true };
  if (typeof raw !== "string") return { ok: false };
  const questions = readPostedShopQuestions(raw);
  if (questions.ok) return { ok: true, questions: questions.questions };
  return {
    ok: false,
    ...(questions.index === undefined ? {} : { questionNumber: questions.index + 1 }),
  };
}

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
 *
 * Bound to the editor through `useActionState` (`./_components/ReleaseForm`):
 * a refusal returns what was typed rather than redirecting, so the release
 * text and the questions stand back up exactly as they were (dive-domain
 * review 2, S2; `./release-form-state.ts`). Every success still redirects
 * with its `?notice=`.
 */
export async function saveWaiverAction(
  _previous: ReleaseFormState,
  formData: FormData,
): Promise<ReleaseFormState> {
  const staff = await requireStaffSession();
  const editor = await getDb();
  if (!(await canPersonManageWaiverTemplates(editor, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(shopPath(staff.user.shopSlug), "waivers-not-authorized"));
  }
  const waivers = shopPath(staff.user.shopSlug, "waivers");
  const materialValue = readForm(materialField, formData).material;
  const rawBody = formData.get("body");
  const refused = (refusal: ReleaseFormRefusal, questionNumber?: number): ReleaseFormState => ({
    status: "refused",
    refusal,
    ...(questionNumber === undefined ? {} : { questionNumber }),
    typed: {
      // The release is capped at 12 000 by the form; nothing longer is echoed.
      body: typeof rawBody === "string" ? rawBody.slice(0, 12_000) : "",
      questions: typedShopQuestions(formData.get("questions")),
      material:
        materialValue === "material" || materialValue === "non-material" ? materialValue : null,
    },
  });
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refused("body");
  const questions = readQuestions(formData);
  if (!questions.ok) return refused("questions", questions.questionNumber);
  // Counted *before* the save, because after it the number is zero by
  // construction: the new version is current and nothing is signed against it
  // yet. This is the same act `saveRequirementsAction` performs for one
  // departure — "here is who that just blocked" — and the reason it exists
  // there applies with the whole shop's roster behind it.
  const atRisk = await standingWaiverExposure(editor, staff.user.shopId);
  // No title: this form has no field for one, so a save cannot mean "rename"
  // and `saveWaiverTemplate` carries the shop's own forward.
  //
  // H-20260822-may-shop-explicitly-declare's two explicit choices, enforced where a POST cannot skip them. The
  // surface asks with a radio pair the form is invalid without
  // (`./_components/PublishRelease.tsx`, ADR 20260827-people-not-lists), but
  // that is a render-time gate on an action reachable without it — and
  // defaulting a missing answer either way would decide, on the shop's behalf,
  // whether its whole roster signs again.
  if (atRisk.divers > 0 && materialValue !== "material" && materialValue !== "non-material") {
    // Its **own** refusal, never the `body` one above. That one says the
    // release needs to be at least a few sentences long, and this refusal is
    // not about the text: an owner told to lengthen a release they never
    // shortened has been handed the wrong problem.
    //
    // Nor is this an adversary-only path. A material publish bumps
    // `materialGeneration`, so the very next render counts zero standing
    // signatures and `PublishRelease` draws no radios at all; divers then sign
    // the new release over the following minutes. The staffer who spots a typo
    // and publishes again *from that same tab* posts no `material` field, and
    // lands here. The path is revalidated for that reason: the refreshed render
    // is what finally puts the choice on screen, beside the text they typed.
    revalidatePath(waivers);
    return refused("materiality");
  }
  const isMaterial = materialValue !== "non-material";
  const { versioned } = await saveWaiverTemplate(editor, {
    shopId: staff.user.shopId,
    body: parsed.data.body,
    questions: questions.questions,
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
  formId: blankAsAbsent(z.uuid()),
  title: single(z.string().trim().min(2).max(COURSE_FORM_TITLE_MAX), ""),
  body: single(z.string().trim().min(COURSE_FORM_BODY_MIN).max(COURSE_FORM_BODY_MAX), ""),
  /**
   * A medical statement: keeps blocking boarding whatever the switch says
   * (#2337). The form posts a hidden `unmarked` beside its box, so a ticked box
   * reads `on`, an unticked one `unmarked`, and a post naming neither leaves
   * the mark as it is, never clearing it by omission.
   */
  medicalScreening: z
    .unknown()
    .optional()
    .transform((value): boolean | undefined => {
      const entries = Array.isArray(value) ? value : [value];
      if (entries.includes("on")) return true;
      if (entries.includes("unmarked")) return false;
      return undefined;
    }),
});

/** The posted form id as typed, for a refusal to land beside the form it was about. */
const formIdField = z.object({ formId: text() });

/** Whether a rewrite asks the shop's divers to sign again; the action reads it itself. */
const materialField = z.object({ material: formValue() });

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
  const postedId = readForm(formIdField, formData).formId;
  const anchorFor = (id: string) => `${waivers}#course-form-${id}`;
  const parsed = parseForm(courseFormSchema, formData);
  if (!parsed.ok) {
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
      medicalScreening: parsed.data.medicalScreening,
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
    medicalScreening: parsed.data.medicalScreening,
  });
  const code = !saved.ok
    ? "course-form-not-found"
    : saved.versioned || saved.marked
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
  const formId = parseForm(z.object({ formId: single(z.uuid()) }), formData);
  const deleted = formId.ok
    ? await deleteCourseForm(db, { shopId: staff.user.shopId, formId: formId.data.formId })
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
