import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { historyComputerDives } from "@/features/computer-dives";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { uuidParam } from "@/lib/uuid";
import { ComputerDives } from "./ComputerDives";

export const instant = true;

/** One ledger, with the upload review above it; a computer record stays personal evidence. */
export default async function ComputerDivesPage({
  params,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
}) {
  const { shopSlug, personId } = await params;
  if (!uuidParam(personId)) notFound();
  const { db, session, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const copy = {
    title: t("computerDives.title"),
    intro: t("computerDives.intro"),
    formats: t("computerDives.formats"),
    files: t("computerDives.files"),
    preview: t("computerDives.preview"),
    previewHeading: t("computerDives.previewHeading"),
    cancel: t("computerDives.cancel"),
    commit: t("computerDives.commit"),
    busy: t("computerDives.busy"),
    target: t("computerDives.target"),
    selected: t("computerDives.selected"),
    zone: t("computerDives.zone"),
    keepZone: t("computerDives.keepZone"),
    offset: t("computerDives.offset"),
    confirmZone: t("computerDives.confirmZone"),
    confirmTarget: t("computerDives.confirmTarget"),
    exact: t("computerDives.exact"),
    possible: t("computerDives.possible"),
    unknown: t("computerDives.unknown"),
    duration: t("computerDives.duration"),
    depth: t("computerDives.depth"),
    device: t("computerDives.device"),
    deviceId: t("computerDives.deviceId"),
    recordingIndex: t("computerDives.recordingIndex"),
    source: t("computerDives.source"),
    localStart: t("computerDives.localStart"),
    instant: t("computerDives.instant"),
    profile: t("computerDives.profile"),
    noProfile: t("computerDives.noProfile"),
    gases: t("computerDives.gases"),
    tanks: t("computerDives.tanks"),
    warnings: t("computerDives.warnings"),
    oxygen: t("computerDives.oxygen"),
    helium: t("computerDives.helium"),
    gasId: t("computerDives.gasId"),
    volume: t("computerDives.volume"),
    startPressure: t("computerDives.startPressure"),
    endPressure: t("computerDives.endPressure"),
    units: t("computerDives.units"),
    sourceId: t("computerDives.sourceId"),
    history: t("computerDives.history"),
    empty: t("computerDives.empty"),
    details: t("computerDives.details"),
    notes: t("computerDives.notes"),
    save: t("computerDives.save"),
    delete: t("computerDives.delete"),
    restore: t("computerDives.restore"),
    deleted: t("computerDives.deleted"),
    export: t("computerDives.export"),
    imported: t("computerDives.imported"),
    skipped: t("computerDives.skipped"),
    fileErrors: t("computerDives.fileErrors"),
    done: t("computerDives.done"),
    saved: t("computerDives.saved"),
    error: t("computerDives.error"),
    retry: t("computerDives.retry"),
    limit: t("computerDives.limit"),
    previewOnly: t("computerDives.previewOnly"),
    template: t("computerDives.template"),
    samples: t("computerDives.samples"),
    seconds: t("computerDives.seconds"),
    meters: t("computerDives.meters"),
    exportHint: t("computerDives.exportHint"),
    fileError: t("computerDives.fileError"),
    offsetHint: t("computerDives.offsetHint"),
    selectionHint: t("computerDives.selectionHint"),
    warningCodes: {
      local_time_unknown: t("computerDives.warningCodes.local_time_unknown"),
      duration_elapsed: t("computerDives.warningCodes.duration_elapsed"),
      unmapped_fit_fields: t("computerDives.warningCodes.unmapped_fit_fields"),
      timezone_unknown: t("computerDives.warningCodes.timezone_unknown"),
      profile_absent: t("computerDives.warningCodes.profile_absent"),
      duration_unknown: t("computerDives.warningCodes.duration_unknown"),
      depth_unknown: t("computerDives.warningCodes.depth_unknown"),
      multiple_recordings: t("computerDives.warningCodes.multiple_recordings"),
    },
    fileErrorCodes: {
      unsupported_fit: t("computerDives.fileErrorCodes.unsupported_fit"),
      unknown_units: t("computerDives.fileErrorCodes.unknown_units"),
      unsafe_xml: t("computerDives.fileErrorCodes.unsafe_xml"),
      file_too_large: t("computerDives.fileErrorCodes.file_too_large"),
      limit_exceeded: t("computerDives.fileErrorCodes.limit_exceeded"),
      invalid_reference: t("computerDives.fileErrorCodes.invalid_reference"),
    },
  };
  const history = await historyComputerDives(db, {
    shopId: session.user.shopId,
    personId,
    actorPersonId: session.user.personId,
  }).catch((error) => {
    if (error instanceof Error && error.message === "not_found") notFound();
    throw error;
  });
  return (
    <StaffPage width="reading">
      <ShopPageHeader title={copy.title} eyebrow={history.personName} />
      <ComputerDives
        shopSlug={shopSlug}
        personId={personId}
        personName={history.personName}
        history={history.dives}
        canExport={history.canExport}
        copy={copy}
      />
    </StaffPage>
  );
}
