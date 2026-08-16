import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions } from "@/components/ui/form";
import type { listDiverNotes } from "@/db/operations";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { addDiverNoteAction, deleteDiverNoteAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

type DiverNote = Awaited<ReturnType<typeof listDiverNotes>>[number];

export function DiverNotesSection({
  notes,
  shopSlug,
  personId,
  locale,
  timezone,
  status,
}: {
  notes: DiverNote[];
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  return (
    <SectionCard
      title={t("divers.notes.heading")}
      description={t("divers.notes.description")}
      className="mt-10"
    >
      {notes.length > 0 ? (
        <ol className="grid gap-3">
          {notes.map(({ note, authorName }) => (
            <li
              key={note.id}
              className="flex items-start justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-3"
            >
              <div className="min-w-0">
                <p className="whitespace-pre-wrap text-base">{note.body}</p>
                <p className="mt-1 text-sm text-muted">
                  {t("divers.notes.writtenBy", {
                    name: authorName,
                    date: formatDateTimeTz(note.createdAt, locale, timezone),
                  })}
                </p>
              </div>
              <form
                action={deleteDiverNoteAction.bind(null, shopSlug, personId)}
                className="shrink-0"
              >
                <input type="hidden" name="noteId" value={note.id} />
                <SubmitButton
                  pendingLabel={t("divers.notes.deleting")}
                  className={buttonClass({ variant: "danger-ghost", size: "sm", busy: true })}
                >
                  {t("divers.notes.delete")}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-base text-muted">{t("divers.notes.empty")}</p>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <PrivateNoteForm
          action={addDiverNoteAction.bind(null, shopSlug, personId)}
          resetKey={notes.length}
          copy={{
            label: t("divers.notes.addLabel"),
            placeholder: t("divers.notes.placeholder"),
            add: t("divers.notes.add"),
            adding: t("divers.notes.adding"),
          }}
        />
        <FieldActions>
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
        </FieldActions>
      </div>
    </SectionCard>
  );
}
