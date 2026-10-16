import {
  deleteCrewRecapPhotoAction,
  deleteRecapPhotoAction,
  saveRecapNoteAction,
  sendRecapAction,
  toggleRecapAutoSendPauseAction,
  uploadCrewRecapPhotoAction,
} from "@/app/shop/[shopSlug]/actions";
import type { getDayCloseout } from "@/db/closeout";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { recapAutoSendAt } from "@/lib/recap-schedule";
import { RecapNoteEditor } from "./RecapNoteEditor";
import { recapStatusLine } from "./recap-status";

type Departure = Awaited<ReturnType<typeof getDayCloseout>>["departures"][number];

/**
 * Each returned departure's recap editor, keyed by trip: written where the crew is standing when
 * they still remember the day, so it rides its own station rather than a page-level section.
 */
export function recapEditorsFor({
  departures,
  noted,
  now,
  locale,
  timeZone,
  t,
}: {
  departures: readonly Departure[];
  noted?: string;
  now: Date;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const recapEditors = new Map<string, React.ReactNode>();
  for (const departure of departures) {
    // Only a returned boat: a trip still out has no day to write about yet,
    // and one that never left has no recap coming.
    if (!departure.ended) continue;
    const autoSendAt = recapAutoSendAt(departure.endsAt, departure.recapAutoSendAt);
    const recapStatusSummary = recapStatusLine(t, departure, autoSendAt, now);
    recapEditors.set(
      departure.tripId,
      <RecapNoteEditor
        context={{
          action: saveRecapNoteAction.bind(null, departure.tripId),
          shoutout: departure.recapShoutout,
          saved: noted === departure.tripId,
          t,
          photos: departure.photos,
          deletePhotoAction: deleteRecapPhotoAction.bind(null, departure.tripId),
          crewPhotos: departure.crewPhotos,
          crewPhotoInputId: `crew-recap-photo-${departure.tripId}`,
          uploadCrewPhotoAction: uploadCrewRecapPhotoAction.bind(null, departure.tripId),
          deleteCrewPhotoAction: deleteCrewRecapPhotoAction.bind(null, departure.tripId),
          tripId: departure.tripId,
          recapSendAction: sendRecapAction.bind(null, departure.tripId),
          toggleRecapAutoSendPauseAction,
          recapAutoSendAt: autoSendAt,
          recapAutoSendAtLabel: autoSendAt
            ? formatDateTimeTz(autoSendAt, locale, timeZone)
            : undefined,
          recapAutoSendPaused: departure.recapAutoSendPaused,
          recapFailed: departure.recapFailed,
          recapNowMs: now.getTime(),
          recapSentAt: departure.recapSentAt,
          recapStatusSummary,
        }}
      />,
    );
  }
  return recapEditors;
}
