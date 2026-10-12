import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

/** One staff note, flattened to what this page renders. */
export type ManifestNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
  scope: "booking" | "diver";
};

type NoteRow = {
  note: { id: string; body: string; createdAt: Date };
  authorName: string;
};
type BookingNoteRow = NoteRow & { note: { bookingId: string | null } };
type DiverNoteRow = NoteRow & { bookingId: string };
type ManifestNoteThreads = Map<string, ManifestNote[]>;

/**
 * Every booking's notes as one thread, oldest first, from the two places a
 * note is written: the Trip surface (`bookingNotes`, booking-scoped) and the
 * Diver record (`diverNotes`, resolved onto this departure's booking).
 */
export function manifestNoteThreads(
  bookingNotes: readonly BookingNoteRow[],
  diverNotes: readonly DiverNoteRow[],
): ManifestNoteThreads {
  // One chronological note thread per booking. A person-scoped note and a
  // booking note are two contexts in the same `internal_notes` source, not two
  // lists the crew has to compare — the scope is retained only where it helps
  // explain why a note follows a diver beyond this departure.
  const notesByBooking = new Map<string, ManifestNote[]>();
  for (const { note, authorName } of bookingNotes) {
    if (!note.bookingId) continue;
    const rows = notesByBooking.get(note.bookingId) ?? [];
    rows.push({
      id: note.id,
      body: note.body,
      authorName,
      createdAt: note.createdAt,
      scope: "booking",
    });
    notesByBooking.set(note.bookingId, rows);
  }
  for (const { note, authorName, bookingId } of diverNotes) {
    const rows = notesByBooking.get(bookingId) ?? [];
    rows.push({
      id: note.id,
      body: note.body,
      authorName,
      createdAt: note.createdAt,
      scope: "diver",
    });
    notesByBooking.set(bookingId, rows);
  }
  for (const rows of notesByBooking.values()) {
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
  return notesByBooking;
}

/**
 * Staff notes that belong on a diver's row, rather than in separate desk and
 * diver-record stacks. Booking notes come from the Guests tab; diver notes
 * come from the Diver record and follow the person onto every booking.
 *
 * The crew reading this page should not have to know whether a note was
 * written before a booking existed or for one particular departure. Both are
 * context, and both read here, on the row they are about.
 *
 * The notes list is read-only here, while the form below writes the same
 * booking-scoped record used by Guests. Historical roll-call notes remain on
 * their append-only roll-call event and are still rendered with the result.
 *
 * `print:hidden`, unlike every other fact on this row. The printed manifest is
 * the sheet that goes ashore with the dock and into a coastguard's hands; a
 * note a shop wrote for itself about a customer is not a document either of
 * them asked for, and paper cannot be un-handed.
 */
export function StaffNotes({
  notes,
  locale,
  timezone,
  t,
}: {
  notes: ReadonlyArray<ManifestNote>;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (notes.length === 0) return null;
  return (
    <section
      aria-label={t("manifest.diverNotesHeading")}
      className="mt-3 rounded-lg bg-surface px-3 py-2 print:hidden"
    >
      <h3 className="text-sm font-semibold">{t("manifest.diverNotesHeading")}</h3>
      <ul className="mt-1 flex flex-col gap-1.5">
        {notes.map((entry) => (
          <li key={entry.id} className="break-words text-base whitespace-pre-wrap">
            {entry.body}
            <span className="ms-1 text-sm text-muted">
              — {entry.authorName} · {formatDateTimeTz(entry.createdAt, locale, timezone)}
              {entry.scope === "diver" ? ` · ${t("manifest.noteAppliesAcrossDepartures")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
