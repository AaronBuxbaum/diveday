import type { getTripConservationPanel } from "@/features/conservation";
import { noticeForForm } from "@/lib/staff-notices";
import { ConservationPanel } from "./ConservationPanel";
import type { detailsReadRows } from "./details-rows";
import { TripAboutLinks } from "./TripAboutLinks";
import { TripAboutSection } from "./TripAboutSection";
import { TripSafetyRecord } from "./TripSafetyRecord";
import { type TripAboutRowsContext, tripAboutRows } from "./trip-about-rows";

/** Definition and post-trip facts share the same labeled-row layout. */
export function TripDetailsPanel({
  context,
  rows,
  conservation,
  personId,
}: {
  context: TripAboutRowsContext;
  rows: Awaited<ReturnType<typeof detailsReadRows>>;
  conservation: Awaited<ReturnType<typeof getTripConservationPanel>>;
  personId: string;
}) {
  const { shop, shopSlug, tripId, t, locale, detailsEditable } = context;
  return (
    <>
      {detailsEditable === false ? (
        <p className="text-sm text-muted">{t("trips.notices.detailsFinished")}</p>
      ) : null}
      <TripAboutSection
        rows={[
          ...tripAboutRows(context),
          ...(detailsEditable === false
            ? [
                {
                  id: "safety-record",
                  label: t("trips.safetyRecord.heading"),
                  value: t(
                    context.overview.trip.exceedsNoDecoLimits
                      ? "trips.safetyRecord.decompression"
                      : "trips.safetyRecord.noDecompression",
                  ),
                  editLabel: t("trips.safetyRecord.correct"),
                  editorOpen: Boolean(noticeForForm(context.tripNotice, "safety-record")),
                  editor: context.overview.canConfigure ? (
                    <TripSafetyRecord
                      key={String(context.overview.trip.exceedsNoDecoLimits)}
                      shopSlug={shopSlug}
                      tripId={tripId}
                      exceedsNoDecoLimits={context.overview.trip.exceedsNoDecoLimits}
                      flySafeTold={context.overview.flySafeTold}
                      t={t}
                      status={noticeForForm(context.tripNotice, "safety-record")}
                    />
                  ) : undefined,
                },
              ]
            : []),
          ...(conservation
            ? [
                {
                  id: "conservation",
                  label: t("trips.conservation.heading"),
                  value: (
                    <ConservationPanel
                      panel={conservation}
                      shopSlug={shopSlug}
                      tripId={tripId}
                      t={t}
                      locale={locale}
                      timeZone={shop.timezone}
                    />
                  ),
                },
              ]
            : []),
          ...rows,
        ]}
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
    </>
  );
}
