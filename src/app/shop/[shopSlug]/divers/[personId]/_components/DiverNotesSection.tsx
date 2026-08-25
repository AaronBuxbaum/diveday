import Link from "next/link";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { FieldActions } from "@/components/ui/form";
import type { listDiverRecordNotes } from "@/db/operations";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { addDiverNoteAction, deleteDiverNoteAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

type DiverRecordNote = Awaited<ReturnType<typeof listDiverRecordNotes>>[number];

export function DiverNotesSection({
  notes,
  shopSlug,
  personId,
  locale,
  timezone,
  status,
}: {
  notes: DiverRecordNote[];
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10" aria-labelledby="notes-heading">
      <h2 id="notes-heading" className="text-lg font-semibold">
        {t("divers.notes.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("divers.notes.description")}</p>
      {notes.length > 0 ? (
        <ol className="mt-4 grid gap-3">
          {notes.map(({ note, authorName, tripId, tripTitle, tripStartsAt }) => (
            <li
              key={note.id}
              className={sectionCardClass({
                padding: "md",
                className: "flex items-start justify-between gap-3 bg-surface-sunken shadow-none",
              })}
            >
              <div className="min-w-0">
                <p className="whitespace-pre-wrap text-base">{note.body}</p>
                <p className="mt-1 text-sm text-muted">
                  {t("divers.notes.writtenBy", {
                    name: authorName,
                    date: formatDateTimeTz(note.createdAt, locale, timezone),
                  })}
                </p>
                {tripId && tripTitle && tripStartsAt ? (
                  <Link
                    href={`/shop/${shopSlug}/trips/${tripId}`}
                    className="mt-1 inline-block text-sm text-primary hover:underline"
                  >
                    {t("divers.notes.fromTrip", {
                      trip: tripTitle,
                      date: formatDateTimeTz(tripStartsAt, locale, timezone),
                    })}
                  </Link>
                ) : note.bookingId === null ? (
                  <p className="mt-1 text-sm text-muted">{t("divers.notes.appliesEverywhere")}</p>
                ) : null}
              </div>
              {note.bookingId === null ? (
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
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <div className={`${notes.length > 0 ? "mt-5 border-t border-border pt-5" : "mt-4"}`}>
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
    </section>
  );
}
