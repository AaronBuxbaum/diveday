import { CallNoteAssist } from "@/components/assists/CallNoteAssist";
import { assistsAvailable } from "@/db/assists";
import { getDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { readCallNoteAction } from "../assist-actions";

/**
 * The Took-a-call form's scribble box (the `call-note` assist, ADR
 * 20261018-claude-assists), rendered only while the shop's assists are on, so
 * a dark shop's form is exactly what it was. Its own read, so the route file
 * stays a list of sections.
 */
export async function CallNoteSlot({
  shopId,
  shopSlug,
  t,
}: {
  shopId: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  if (!(await assistsAvailable(await getDb(), shopId))) return null;
  return (
    <CallNoteAssist
      read={readCallNoteAction.bind(null, shopSlug)}
      words={{
        label: t("assistsFront.callNote.label"),
        hint: t("assistsFront.callNote.hint"),
        fill: t("assistsFront.callNote.fill"),
        filling: t("assistsFront.callNote.filling"),
        onFile: t.raw("assistsFront.callNote.onFile"),
        nothing: t("assistsFront.callNote.nothing"),
      }}
    />
  );
}
