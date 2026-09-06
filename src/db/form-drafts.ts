import { and, eq, gt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type DraftFields,
  draftableFields,
  draftHasContent,
  draftIsFresh,
  FORM_DRAFT_TTL_MS,
  type FormDraftKind,
} from "@/lib/form-drafts";
import type { AppDb } from "./client";
import { formDrafts } from "./schema";

/**
 * Staff form drafts (ADR 20260906-before-you-ask, decision 3): one row per
 * person and form, bumped on every write, read back fresh for a day. Nothing
 * here is a record of anything — it is what a person had typed the moment
 * they were interrupted — so a stale one is dropped rather than shown.
 */
export type FormDraft = { form: FormDraftKind; fields: DraftFields; savedAt: Date };

export async function saveFormDraft(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    form: FormDraftKind;
    fields: Iterable<[string, string]>;
    now?: Date;
  },
): Promise<"saved" | "empty"> {
  const fields = draftableFields(input.fields);
  // A form of blanks is not a draft; an existing one is cleared rather than
  // overwritten with nothing.
  if (!draftHasContent(fields)) {
    await discardFormDraft(db, input.shopId, input.personId, input.form);
    return "empty";
  }
  const savedAt = input.now ?? nowDate();
  await db
    .insert(formDrafts)
    .values({ shopId: input.shopId, personId: input.personId, form: input.form, fields, savedAt })
    .onConflictDoUpdate({
      target: [formDrafts.shopId, formDrafts.personId, formDrafts.form],
      set: { fields, savedAt },
    });
  return "saved";
}

export async function readFormDraft(
  db: AppDb,
  shopId: string,
  personId: string,
  form: FormDraftKind,
  now = nowDate(),
): Promise<FormDraft | null> {
  const [row] = await db
    .select({ fields: formDrafts.fields, savedAt: formDrafts.savedAt })
    .from(formDrafts)
    .where(
      and(
        eq(formDrafts.shopId, shopId),
        eq(formDrafts.personId, personId),
        eq(formDrafts.form, form),
      ),
    );
  if (!row || !draftIsFresh(row.savedAt, now)) return null;
  return { form, fields: row.fields, savedAt: row.savedAt };
}

export async function discardFormDraft(
  db: AppDb,
  shopId: string,
  personId: string,
  form: FormDraftKind,
): Promise<void> {
  await db
    .delete(formDrafts)
    .where(
      and(
        eq(formDrafts.shopId, shopId),
        eq(formDrafts.personId, personId),
        eq(formDrafts.form, form),
      ),
    );
}

/** Every fresh draft this person holds — the home's "Unfinished" rows. */
export async function listFreshFormDrafts(
  db: AppDb,
  shopId: string,
  personId: string,
  now = nowDate(),
): Promise<Array<{ form: FormDraftKind; savedAt: Date }>> {
  const rows = await db
    .select({ form: formDrafts.form, savedAt: formDrafts.savedAt })
    .from(formDrafts)
    .where(
      and(
        eq(formDrafts.shopId, shopId),
        eq(formDrafts.personId, personId),
        gt(formDrafts.savedAt, new Date(now.getTime() - FORM_DRAFT_TTL_MS)),
      ),
    )
    .orderBy(formDrafts.savedAt);
  return rows.map((row) => ({ form: row.form as FormDraftKind, savedAt: row.savedAt }));
}
