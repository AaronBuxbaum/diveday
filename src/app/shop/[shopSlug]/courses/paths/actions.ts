"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  createCoursePath,
  deleteCoursePath,
  getCoursePathBySlug,
  setCoursePathVisibility,
  uniquePathSlug,
  updateCoursePath,
} from "@/db/course-paths";
import { sanitizePathSteps } from "@/lib/courses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

const listPath = (shopSlug: string) => `/shop/${shopSlug}/courses/paths`;
const builderPath = (shopSlug: string, slug: string) => `${listPath(shopSlug)}/${slug}`;

/**
 * Shaping the catalog is owner/manager/instructor work — the same bar trip
 * definition clears (H-14, ADR 20260724-role-authorization) — because a path is
 * what the shop tells a diver to do next, not a note anyone at the desk jots
 * down. Re-checked against live roles on every write, so a revoked role takes
 * effect on the next action rather than at the next sign-in.
 */
async function requireCatalogAuthor(back: string) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
    redirect(`${back}?error=not-authorized`);
  }
  return { session, db };
}

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(240),
});

export async function createPathAction(shopSlug: string, formData: FormData) {
  const back = listPath(shopSlug);
  const { session, db } = await requireCatalogAuthor(back);
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?error=invalid`);

  const slug = await uniquePathSlug(db, session.user.shopId, parsed.data.title);
  const created = await createCoursePath(db, {
    shopId: session.user.shopId,
    title: parsed.data.title,
    summary: parsed.data.summary,
    slug,
  });
  // The only way this fails is the (shop_id, title) unique index — the shop
  // already has a path by this name, which is a message, not a crash.
  if (!created) redirect(`${back}?error=duplicate`);
  revalidateAndRedirect(back, builderPath(shopSlug, slug));
}

const saveSchema = detailsSchema.extend({
  stepsJson: z.string().max(20_000),
  isActive: z.string().optional(),
});

export async function savePathAction(shopSlug: string, slug: string, formData: FormData) {
  const back = builderPath(shopSlug, slug);
  const { session, db } = await requireCatalogAuthor(back);
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?error=invalid`);

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.stepsJson);
  } catch {
    redirect(`${back}?error=invalid`);
  }
  const steps = sanitizePathSteps(raw);
  if (!steps) redirect(`${back}?error=invalid`);

  const path = await getCoursePathBySlug(db, session.user.shopId, slug);
  if (!path) redirect(listPath(shopSlug));

  const saved = await updateCoursePath(db, session.user.shopId, path.id, {
    title: parsed.data.title,
    summary: parsed.data.summary,
    // An unchecked checkbox posts nothing at all, which is exactly "hidden".
    isActive: parsed.data.isActive === "on",
    steps,
  });
  if (!saved) redirect(`${back}?error=duplicate`);
  revalidateAndRedirect(back, `${back}?saved=1`);
}

export async function deletePathAction(shopSlug: string, formData: FormData) {
  const back = listPath(shopSlug);
  const { session, db } = await requireCatalogAuthor(back);
  const pathId = z.uuid().safeParse(formData.get("pathId"));
  if (pathId.success) await deleteCoursePath(db, session.user.shopId, pathId.data);
  revalidateAndRedirect(back, back);
}

/**
 * One-click hide/show, mirroring the eye toggle on the course list. No redirect:
 * a same-page redirect after a one-click toggle resets scroll to the top, which
 * reads as the page jumping.
 */
export async function setPathVisibilityAction(shopSlug: string, formData: FormData) {
  const { session, db } = await requireCatalogAuthor(listPath(shopSlug));
  const pathId = z.uuid().safeParse(formData.get("pathId"));
  if (pathId.success) {
    await setCoursePathVisibility(
      db,
      session.user.shopId,
      pathId.data,
      formData.get("visible") === "true",
    );
  }
  revalidatePath(listPath(shopSlug));
}
