import Link from "next/link";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldActions } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { listDiverRecordNotes } from "@/db/operations";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { addDiverNoteAction, deleteDiverNoteAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

type DiverRecordNote = Awaited<ReturnType<typeof listDiverRecordNotes>>[number];

/**
 * **Notes — the shop's own context about this diver**, in the file's inset
 * group rather than a stack of sunken cards (ADR 20260827-people-not-lists:
 * "Notes stay a quiet group").
 *
 * The one sentence that survives the copy pass is the one carrying a
 * consequence the surface cannot show: what is typed here reaches the crew on
 * the boat manifest. A note that arrived *with* a booking is the trip's, not
 * the record's, and cannot be deleted from here — its row says which departure
 * it came from instead.
 */
export function DiverNotesSection({
  notes,
  shopSlug,
  personId,
  locale,
  timezone,
  t,
  status,
}: {
  notes: DiverRecordNote[];
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  return (
    <section className="mt-8" aria-labelledby="notes">
      <InsetGroup as="h2" id="notes" label={t("divers.notes.heading")} className="scroll-mt-24">
        {notes.map(({ note, authorName, tripId, tripTitle, tripStartsAt }) => (
          <div key={note.id} className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="whitespace-pre-wrap">{note.body}</p>
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
          </div>
        ))}
        <div className="px-5 py-4 sm:px-6">
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
          <p className="mt-2 text-sm text-muted">{t("divers.notes.description")}</p>
          <FieldActions>
            <DiverFormStatus status={status} />
          </FieldActions>
        </div>
      </InsetGroup>
    </section>
  );
}
