import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { AppDb } from "@/db/client";
import { listDepartureBoardedByTrip } from "@/db/manifests";
import type { TripGuests } from "@/features/trips/trip-guests";
import { repeatsRowText } from "@/i18n/series-sentences";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import type { detailsReadRows } from "../details-rows";
import { safetyRecordShown } from "../safety-record-shown";
import { TripAboutLinks } from "../TripAboutLinks";
import { type TripAboutRow, TripAboutSection } from "../TripAboutSection";
import { TripPromoteAndActivity } from "../TripRosterContent";
import { TripSafetyRecord } from "../TripSafetyRecord";
import { MORE_SETTINGS_ROWS, type TripAboutRowsContext, tripAboutRows } from "../trip-about-rows";
import { CallOffCard, PrintCard, RepeatsCard } from "./EditTripSide";

/**
 * **Edit trip** (`?view=edit`, ADR 20261117-trip-page-clock): everything
 * about the trip that is not about today. "This trip" holds the rows a
 * staffer changes (when, meet, boat, crew, plan, price, who can book,
 * conditions), each opening its own form; the rare ones fold into one closed
 * "More settings"; the deal history and the note to guests sit below. Beside
 * them: the run's one line and its door to Schedule, Print, and last, calling
 * the trip off.
 */
export async function EditTrip({
  context,
  readRows,
  db,
  personId,
  guests,
  mayDiscount,
  mayChangeDeparture,
  lifecycleStatus,
  doneHref,
}: {
  context: TripAboutRowsContext;
  readRows: Awaited<ReturnType<typeof detailsReadRows>>;
  db: AppDb;
  personId: string;
  guests: TripGuests;
  mayDiscount: boolean;
  mayChangeDeparture: boolean;
  lifecycleStatus: FormNotice | undefined;
  doneHref: string;
}) {
  const { overview, shop, shopSlug, tripId, locale, t, tripNotice, detailsEditable } = context;
  const { trip, cancelled, canConfigure, series } = overview;
  const safety = await safetyRecordRow(context, db);
  const rows: TripAboutRow[] = [
    ...tripAboutRows(context),
    ...(safety ? [safety] : []),
    ...readRows,
  ];
  const main = rows.filter((row) => !MORE_SETTINGS_ROWS.has(row.id));
  const more = rows.filter((row) => MORE_SETTINGS_ROWS.has(row.id));
  const moreOpen = more.some((row) => row.editorOpen);
  return (
    <section data-phase-panel="edit" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className={SECTION_TITLE_CLASS}>{t("trips.clock.editTrip")}</h2>
        <Link href={doneHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {t("trips.clock.editDone")}
        </Link>
      </div>
      {detailsEditable === false && !cancelled ? (
        <p className="text-sm text-muted">{t("trips.notices.detailsFinished")}</p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <TripAboutSection
            heading={t("trips.about.thisTrip")}
            rows={main}
            editLabel={t("trips.about.edit")}
            actions={
              <TripAboutLinks
                shop={shop}
                personId={personId}
                shopSlug={shopSlug}
                tripId={tripId}
                t={t}
              />
            }
          />
          {more.length > 0 ? (
            <details
              open={moreOpen || undefined}
              className={sectionCardClass({ padding: "none", className: "group/settings" })}
            >
              <summary className={cardSummaryClass({ className: "min-h-14 px-4 py-4 sm:px-6" })}>
                <SummaryCaret className="group-open/settings:rotate-90" />
                <span className="font-semibold">{t("trips.about.moreSettings")}</span>
              </summary>
              <div className="px-4 pb-4 sm:px-6">
                <TripAboutSection
                  id="more-settings"
                  rows={more}
                  editLabel={t("trips.about.edit")}
                />
              </div>
            </details>
          ) : null}
          <TripPromoteAndActivity
            {...{ guests, shopSlug, locale, shop, tripNotice, mayDiscount }}
            dayOnly
          />
        </div>
        <div className="min-w-0 space-y-6">
          <RepeatsCard
            line={repeatsRowText(t, locale, series)}
            href={series && canConfigure ? shopPath(shopSlug, "schedule", "series", tripId) : null}
            t={t}
          />
          <PrintCard shopSlug={shopSlug} tripId={tripId} t={t} />
          {mayChangeDeparture ? (
            <CallOffCard
              shop={shop}
              personId={personId}
              tripId={tripId}
              startsAt={trip.startsAt}
              lifecycleStatus={lifecycleStatus}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * **The dive safety record** once the plan is closed: whether these dives went
 * past no-decompression limits, which the flying guidance hangs on, with its
 * correction for those who may configure the trip. A cancelled trip keeps it
 * when anyone boarded (a blow-out after the first tank still counts); one that
 * never sailed has nothing to record.
 */
async function safetyRecordRow(
  context: TripAboutRowsContext,
  db: AppDb,
): Promise<TripAboutRow | null> {
  const { overview, shop, shopSlug, tripId, t, tripNotice, detailsEditable } = context;
  if (detailsEditable !== false) return null;
  const boarded = overview.cancelled
    ? ((await listDepartureBoardedByTrip(db, shop.id, [tripId])).get(tripId)?.size ?? 0)
    : 0;
  if (!safetyRecordShown({ detailsEditable, cancelled: overview.cancelled, boarded })) return null;
  const status = noticeForForm(tripNotice, "safety-record");
  return {
    id: "safety-record",
    label: t("trips.safetyRecord.heading"),
    value: t(
      overview.trip.exceedsNoDecoLimits
        ? "trips.safetyRecord.decompression"
        : "trips.safetyRecord.noDecompression",
    ),
    editLabel: t("trips.safetyRecord.correct"),
    editorOpen: Boolean(status),
    editor: overview.canConfigure ? (
      <TripSafetyRecord
        key={String(overview.trip.exceedsNoDecoLimits)}
        shopSlug={shopSlug}
        tripId={tripId}
        exceedsNoDecoLimits={overview.trip.exceedsNoDecoLimits}
        flySafeTold={overview.flySafeTold}
        t={t}
        status={status}
      />
    ) : undefined,
  };
}
