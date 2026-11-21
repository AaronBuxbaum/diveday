import { notFound, redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { requireShopSurface } from "@/features/accounts/session";
import { historyComputerDives } from "@/features/after-the-dive/computer-dives";
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
  // Switched off on the Features page: back to the diver, no error.
  if (!shop.computerDivesEnabled) redirect(`/shop/${shopSlug}/divers/${personId}`);
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
    importMore: t("computerDives.importMore"),
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
      timezone_unknown: t("computerDives.warningCodes.timezone_unknown"),
      profile_absent: t("computerDives.warningCodes.profile_absent"),
      duration_unknown: t("computerDives.warningCodes.duration_unknown"),
      depth_unknown: t("computerDives.warningCodes.depth_unknown"),
      multiple_recordings: t("computerDives.warningCodes.multiple_recordings"),
      local_time_unknown: t("computerDives.warningCodes.local_time_unknown"),
      duration_elapsed: t("computerDives.warningCodes.duration_elapsed"),
      unmapped_fit_fields: t("computerDives.warningCodes.unmapped_fit_fields"),
      date_only: t("computerDives.warningCodes.date_only"),
    },
    fileErrorCodes: {
      unsupported_fit: t("computerDives.fileErrorCodes.unsupported_fit"),
      unknown_units: t("computerDives.fileErrorCodes.unknown_units"),
      unsafe_xml: t("computerDives.fileErrorCodes.unsafe_xml"),
      file_too_large: t("computerDives.fileErrorCodes.file_too_large"),
      limit_exceeded: t("computerDives.fileErrorCodes.limit_exceeded"),
      invalid_reference: t("computerDives.fileErrorCodes.invalid_reference"),
      invalid_csv: t("computerDives.fileErrorCodes.invalid_csv"),
      invalid_options: t("computerDives.fileErrorCodes.invalid_options"),
      invalid_zip: t("computerDives.fileErrorCodes.invalid_zip"),
      unsafe_zip: t("computerDives.fileErrorCodes.unsafe_zip"),
      zip_limit_exceeded: t("computerDives.fileErrorCodes.zip_limit_exceeded"),
      no_dives: t("computerDives.fileErrorCodes.no_dives"),
    },
    deviceId: t("computerDives.deviceId"),
    recordingIndex: t("computerDives.recordingIndex"),
    fileErrors: t("computerDives.fileErrors"),
    zipHint: t("computerDives.zipHint"),
    beta: t("computerDives.beta"),
    provider: t("computerDives.provider"),
    providerGuide: t("computerDives.providerGuide"),
    betaHint: t("computerDives.betaHint"),
    chosenSource: t("computerDives.chosenSource"),
    localDate: t("computerDives.localDate"),
    unknownTime: t("computerDives.unknownTime"),
    zipEntry: t("computerDives.zipEntry"),
    zipIgnored: t("computerDives.zipIgnored"),
    exportCsv: t("computerDives.exportCsv"),
    exportCsvHint: t("computerDives.exportCsvHint"),
    mapCsv: t("computerDives.mapCsv"),
    mappingHint: t("computerDives.mappingHint"),
    mappingError: t("computerDives.mappingError"),
    mappingReading: t("computerDives.mappingReading"),
    mappingChoose: t("computerDives.mappingChoose"),
    mappingNone: t("computerDives.mappingNone"),
    mappingRequired: t("computerDives.mappingRequired"),
    mappingOffsetHint: t("computerDives.mappingOffsetHint"),
    mappingDateHint: t("computerDives.mappingDateHint"),
    providers: {
      generic: {
        label: t("computerDives.providers.generic.label"),
        hint: t("computerDives.providers.generic.hint"),
      },
      oceanic: {
        label: t("computerDives.providers.oceanic.label"),
        hint: t("computerDives.providers.oceanic.hint"),
      },
      padi: {
        label: t("computerDives.providers.padi.label"),
        hint: t("computerDives.providers.padi.hint"),
      },
      ssi: {
        label: t("computerDives.providers.ssi.label"),
        hint: t("computerDives.providers.ssi.hint"),
      },
      garmin: {
        label: t("computerDives.providers.garmin.label"),
        hint: t("computerDives.providers.garmin.hint"),
      },
      shearwater: {
        label: t("computerDives.providers.shearwater.label"),
        hint: t("computerDives.providers.shearwater.hint"),
      },
      subsurface: {
        label: t("computerDives.providers.subsurface.label"),
        hint: t("computerDives.providers.subsurface.hint"),
      },
      suunto: {
        label: t("computerDives.providers.suunto.label"),
        hint: t("computerDives.providers.suunto.hint"),
      },
    },
    mapping: {
      date: t("computerDives.mapping.date"),
      time: t("computerDives.mapping.time"),
      duration: t("computerDives.mapping.duration"),
      maxDepth: t("computerDives.mapping.maxDepth"),
      utcOffset: t("computerDives.mapping.utcOffset"),
      device: t("computerDives.mapping.device"),
      sourceId: t("computerDives.mapping.sourceId"),
      dateFormat: t("computerDives.mapping.dateFormat"),
      durationUnit: t("computerDives.mapping.durationUnit"),
      depthUnit: t("computerDives.mapping.depthUnit"),
      chooseFormat: t("computerDives.mapping.chooseFormat"),
      chooseUnit: t("computerDives.mapping.chooseUnit"),
      iso: t("computerDives.mapping.iso"),
      dmy: t("computerDives.mapping.dmy"),
      mdy: t("computerDives.mapping.mdy"),
      seconds: t("computerDives.mapping.seconds"),
      minutes: t("computerDives.mapping.minutes"),
      m: t("computerDives.mapping.m"),
      ft: t("computerDives.mapping.ft"),
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
