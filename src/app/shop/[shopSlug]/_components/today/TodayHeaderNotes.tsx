import Link from "next/link";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import type { getTodayWork } from "@/db/today";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";

type NextDeparture = NonNullable<Awaited<ReturnType<typeof getTodayWork>>["nextDeparture"]>;

/** What sits under the date: the next boat on an empty board, the offline marker. */
export function TodayHeaderNotes({
  shopSlug,
  quietDay,
  hasStations,
  nextDeparture,
  showFirstRunChecklist,
  locale,
  timeZone,
  t,
}: {
  shopSlug: string;
  quietDay: boolean;
  hasStations: boolean;
  nextDeparture: NextDeparture | null;
  showFirstRunChecklist: boolean;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <>
      {/* First run says nothing here (UX review 2026-10-10, item 29): the
            checklist below counts what is left, and its share row carries the
            address as a copy control rather than a URL printed in prose. */}
      {/* A day with no boats answers its follow-up question right here. */}
      {!quietDay && !hasStations && nextDeparture ? (
        <p className="mt-1 max-w-2xl text-muted">
          {t.rich("shopHome.nextDeparture", {
            link: (chunks) => (
              <Link
                href={`/shop/${shopSlug}/trips/${nextDeparture.tripId}`}
                className="font-medium text-primary hover:underline"
              >
                {chunks}
              </Link>
            ),
            title: nextDeparture.title,
            date: formatShortDate(nextDeparture.startsAt, locale, timeZone),
            time: formatTime(nextDeparture.startsAt, locale, timeZone),
          })}
        </p>
      ) : null}
      {/* Nothing on the books at all (and past first-run, whose ledger
                owns "schedule your first trip"): one teaching sentence and the
                door, not a boxed section. */}
      {!quietDay && !hasStations && !nextDeparture && !showFirstRunChecklist ? (
        <p className="mt-1 max-w-2xl text-muted">
          {t("shopHome.noDeparturesEmpty")}{" "}
          <Link
            href={`/shop/${shopSlug}/schedule/board?add=1`}
            className="font-medium text-primary hover:underline"
          >
            {t("shopHome.scheduleTrip")}
          </Link>
        </p>
      ) : null}
      {/* **Live-only, and it should say so.** This board is read straight
                from the server every render — the boat has an encrypted device
                copy, this does not — so a dropped signal means the counts, the
                crew line and the blocked names are whatever they were when the
                signal went (issue #819). */}
      <ConnectivityStatus
        offlineLabel={t("shopHome.offlineLabel")}
        onlyWhenOffline
        className="mt-2"
        copy={{
          online: t("shared.connectivity.online"),
          onlineTitle: t("shared.connectivity.onlineTitle"),
          offlineTitle: t("shared.connectivity.offlineTitle"),
        }}
      />
    </>
  );
}
