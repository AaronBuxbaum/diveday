import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { RosterPrivateNote } from "./roster-model";

export function SeatNotes({
  bookingId,
  notes,
  t,
  locale,
  shopTimezone,
  addNoteAction,
  deleteNoteAction,
}: {
  bookingId: string;
  notes: RosterPrivateNote[];
  t: StaffTranslator;
  locale: string;
  shopTimezone: string;
  addNoteAction: (formData: FormData) => void;
  deleteNoteAction: (formData: FormData) => void;
}) {
  return (
    <div className="mt-5 border-t border-border pt-3">
      <CompactDisclosureRow
        bodyClassName="mt-2"
        label={
          // A zero count is the absence of information formatted as
          // information (principle 9) — with no notes the disclosure is
          // simply the door to writing the first one.
          notes.length === 0
            ? t("trips.roster.addFirstNoteSummary")
            : t("trips.roster.privateStaffNotes", { count: notes.length })
        }
      >
        <div className="grid gap-3">
          {notes.map((entry) => {
            const { note, authorName } = entry;
            return (
              <div
                key={note.id}
                className={`flex items-start justify-between gap-2 ${INSET_NOTE_BOX} bg-surface-sunken`}
              >
                <div className="min-w-0">
                  <p className="break-words whitespace-pre-wrap">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {authorName} · {formatDateTimeTz(note.createdAt, locale, shopTimezone)}
                  </p>
                </div>
                {entry.deletable === false ? null : (
                  <form action={deleteNoteAction} className="shrink-0">
                    <input type="hidden" name="noteId" value={note.id} />
                    {/* No confirm dialog: the delete lands and a toast
                        offers a one-tap undo — a purely reversible edit,
                        not a real send (principle 7). */}
                    <SubmitButton
                      pendingLabel={t("trips.roster.deletingEllipsis")}
                      className={buttonClass({
                        variant: "danger-ghost",
                        size: "sm",
                        busy: true,
                      })}
                    >
                      {t("trips.roster.delete")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
          {/* Keyed on the note count so a landed note empties the box. */}
          <PrivateNoteForm
            action={addNoteAction}
            hiddenFields={{ bookingId }}
            resetKey={notes.length}
            rows={2}
            copy={{
              label: t("trips.roster.addNoteLabel"),
              add: t("trips.roster.addPrivateNote"),
              adding: t("trips.roster.adding"),
            }}
          />
        </div>
      </CompactDisclosureRow>
    </div>
  );
}
