import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { sendHoldCopy } from "@/components/send-hold-copy";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { getDb } from "@/db/client";
import { lastDayStartsAt, listDepartureNotes } from "@/db/departure-notes";
import { fill } from "@/i18n/fill";
import { sayWords, sendLimitWords } from "@/i18n/shared-sentences";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_NOTES_PER_DEPARTURE, departureNoteBlock } from "@/lib/departure-notes";
import { formatWeekdayTime } from "@/lib/format";
import { holdDepartureNoteAction } from "../departure-note-actions";
import { DepartureNoteForm } from "./DepartureNoteForm";
import { FOOT_ROW_BODY, FOOT_ROW_SUMMARY } from "./TripAboutSection";

/**
 * **A note to everyone on a departure** (batch 4, J4), a row on the trip's
 * Details tab beside the last-minute deal: the box while the departure can
 * still take one, and the notes it has carried. A cancelled or sailed
 * departure with no notes draws nothing. Reads its own rows, as
 * `BlowoutDoors` does, so the page passes nothing new.
 */
export async function DepartureNoteSection({
  locale,
  shop,
  trip,
}: {
  locale: string;
  shop: { id: string; timezone: string };
  trip: { id: string; status: string; startsAt: Date; isRehearsal: boolean };
}) {
  const t = staffTranslator(locale);
  // A rehearsal tells nobody anything (ADR 20261012-rehearsal-departures).
  if (trip.isRehearsal) return null;
  const db = await getDb();
  const [notes, lastDay] = await Promise.all([
    listDepartureNotes(db, shop.id, trip.id),
    lastDayStartsAt(db, trip.id),
  ]);
  const block = departureNoteBlock({ ...trip, lastDayStartsAt: lastDay }, notes.length, nowDate());
  if (block && block !== "limit" && notes.length === 0) return null;
  const limit = t("desk.departureNote.refusals.limit", { max: DEPARTURE_NOTES_PER_DEPARTURE });
  return (
    <AutoOpenDetails openOnHash="departure-note" className="group/note scroll-mt-6">
      <summary className={FOOT_ROW_SUMMARY}>
        <span>{t("desk.departureNote.heading")}</span>
        <span className="flex items-center gap-2">
          {notes.length > 0 ? t("desk.departureNote.sentCount", { count: notes.length }) : null}
          <DisclosureCaret direction="down" className="size-4 group-open/note:rotate-180" />
        </span>
      </summary>
      <div className={`space-y-4 ${FOOT_ROW_BODY}`}>
        {block ? null : <p className="text-sm text-muted">{t("desk.departureNote.description")}</p>}
        {notes.length > 0 ? (
          <ul className="space-y-2 text-sm" data-testid="departure-notes">
            {notes.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <p className="text-xs text-muted">
                  {fill(t.raw("desk.departureNote.sentLine"), {
                    when: formatWeekdayTime(note.sentAt, locale, shop.timezone),
                    name: note.sentByName ?? t("desk.departureNote.someone"),
                    delivered: note.delivered,
                    recipients: note.recipients,
                  })}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {block === "limit" ? (
          <p className="text-sm text-muted">{limit}</p>
        ) : block ? null : (
          <DepartureNoteForm
            hold={holdDepartureNoteAction.bind(null, trip.id)}
            copy={{
              label: t("desk.departureNote.label"),
              left: t.raw("desk.departureNote.left"),
              submit: t("desk.departureNote.submit"),
              sent: t.raw("desk.departureNote.sent"),
              sendHold: sendHoldCopy(t),
              refusals: {
                empty: t("desk.departureNote.refusals.empty"),
                too_long: t("desk.departureNote.refusals.tooLong"),
                link: t("desk.departureNote.refusals.link"),
                cancelled: t("desk.departureNote.refusals.cancelled"),
                past: t("desk.departureNote.refusals.past"),
                limit,
                no_recipients: t("desk.departureNote.refusals.noRecipients"),
                rate_limited: sayWords(t, sendLimitWords("notes")),
                other: t("desk.departureNote.refusals.other"),
              },
            }}
          />
        )}
      </div>
    </AutoOpenDetails>
  );
}
