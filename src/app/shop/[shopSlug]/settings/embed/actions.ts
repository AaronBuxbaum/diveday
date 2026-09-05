"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageShopSettings } from "@/db/authz";
import {
  createEmbedSet,
  deleteEmbedSet,
  type EmbedSetRefusal,
  updateEmbedSet,
} from "@/db/embed-sets";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { EMBED_SETS_FORM } from "./forms";

/**
 * The named embed lists' three mutations (issue #1284).
 *
 * Colocated here rather than as inline closures because this page now carries
 * several forms — one per existing list, plus the two that create one — and
 * AGENTS.md puts a large page's actions in a sibling `actions.ts`.
 *
 * Each one re-resolves the surface through `requireShopSurface` and never
 * trusts the form's own slug for anything but the redirect target: the shop is
 * the session's, and the permission gate is re-asked live. The membership
 * arrives from a checkbox list, so `src/db/embed-sets.ts` validates every
 * member against this shop's rows before storing — a devtools edit on a
 * checkbox cannot put another tenant's departure on a public widget.
 */

const setForm = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().min(1).max(200)).min(1),
});

const kindField = z.enum(["trip", "course"]);

function membersFrom(formData: FormData): string[] {
  return formData.getAll("memberIds").filter((value): value is string => typeof value === "string");
}

/** Every code this page answers with, kebab and spelled out rather than built. */
type EmbedSetNotice =
  | "embed-set-saved"
  | "embed-set-deleted"
  | "embed-set-invalid"
  | "embed-set-too-many"
  | "embed-set-missing";

async function back(shopSlug: string, code: EmbedSetNotice): Promise<never> {
  redirect(noticeUrl(shopPath(shopSlug, "settings", "embed"), code, { form: EMBED_SETS_FORM }));
}

/** A refusal from `src/db/embed-sets.ts`, in this page's own vocabulary. */
function refusalNotice(reason: EmbedSetRefusal): EmbedSetNotice {
  if (reason === "not_found") return "embed-set-missing";
  // The cap keeps a sentence of its own: naming the number is what a shop that
  // ticked twenty-five boats needs, where "pick at least one" would send them
  // looking for the wrong mistake.
  if (reason === "too_many") return "embed-set-too-many";
  return "embed-set-invalid";
}

export async function createEmbedSetAction(formData: FormData) {
  const { db, shop } = await requireShopSurface(String(formData.get("shopSlug") ?? ""), {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const parsed = setForm.safeParse({
    name: formData.get("name"),
    memberIds: membersFrom(formData),
  });
  const kind = kindField.safeParse(formData.get("kind"));
  if (!parsed.success || !kind.success) return back(shop.slug, "embed-set-invalid");

  const outcome = await createEmbedSet(db, shop.id, {
    name: parsed.data.name,
    kind: kind.data,
    memberIds: parsed.data.memberIds,
  });
  return back(shop.slug, outcome.ok ? "embed-set-saved" : refusalNotice(outcome.reason));
}

export async function updateEmbedSetAction(formData: FormData) {
  const { db, shop } = await requireShopSurface(String(formData.get("shopSlug") ?? ""), {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const setId = String(formData.get("setId") ?? "");
  const parsed = setForm.safeParse({
    name: formData.get("name"),
    memberIds: membersFrom(formData),
  });
  if (!setId || !parsed.success) return back(shop.slug, "embed-set-invalid");

  const outcome = await updateEmbedSet(db, shop.id, setId, parsed.data);
  return back(shop.slug, outcome.ok ? "embed-set-saved" : refusalNotice(outcome.reason));
}

export async function deleteEmbedSetAction(formData: FormData) {
  const { db, shop } = await requireShopSurface(String(formData.get("shopSlug") ?? ""), {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const setId = String(formData.get("setId") ?? "");
  if (!setId) return back(shop.slug, "embed-set-invalid");

  const outcome = await deleteEmbedSet(db, shop.id, setId);
  return back(shop.slug, outcome.ok ? "embed-set-deleted" : refusalNotice(outcome.reason));
}
