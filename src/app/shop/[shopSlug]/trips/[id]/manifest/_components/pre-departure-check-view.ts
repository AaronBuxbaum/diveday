import type { OpenSnag } from "@/db/boat-snags";
import type { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { SnagActions } from "./PreDepartureCheckList";

/**
 * One open snag's sentences, as the live check, the printed sheet and the
 * saved offline copy all say them.
 */
export function snagSentences({
  snag,
  locale,
  timeZone,
  t,
}: {
  snag: OpenSnag;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const when = (date: Date) => formatDateTimeTz(date, locale, timeZone);
  const notedBy = t("trips.preDepartureCheck.snagNotedBy", {
    name: snag.notedByName,
    date: when(snag.notedAt),
  });
  return {
    id: snag.id,
    line: t("trips.preDepartureCheck.snagLine", { item: snag.itemLabel, note: snag.note }),
    note: snag.note,
    notedBy,
    stillThere: snag.stillThere
      ? t("trips.preDepartureCheck.snagStillThereBy", {
          name: snag.stillThere.byName,
          date: when(snag.stillThere.at),
        })
      : undefined,
    printLine: t("trips.preDepartureCheck.printSnag", {
      item: snag.itemLabel,
      note: snag.note,
      noted: notedBy,
    }),
  };
}

/**
 * The boat check as `PreDepartureCheckList` draws it: each item with who
 * checked it and when, the sentence paper keeps, and the summary line's
 * count. With the boat's open snags (fifth-loop ideas, item 1): the ones an
 * earlier crew handed on stand above the list, and the ones this crew wrote
 * sit under their own line.
 */
export function preDepartureCheckView({
  checklistItems,
  checklistChecks,
  snags = [],
  snagActions,
  locale,
  timeZone,
  t,
}: {
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>;
  checklistChecks: Awaited<ReturnType<typeof latestPreDepartureChecksForTrip>>;
  /** `openSnagsForTrip`: open snags on this departure's boat. */
  snags?: readonly OpenSnag[];
  /** Present only when the departure has a boat, so a note has a next crew to reach. */
  snagActions?: SnagActions;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const snagView = (snag: OpenSnag) => snagSentences({ snag, locale, timeZone, t });
  const checklistListItems = checklistItems.map((item) => {
    const check = checklistChecks.get(item.id);
    const checkedByLine = check
      ? t("trips.preDepartureCheck.checkedBy", {
          name: check.recordedByName,
          date: formatDateTimeTz(check.occurredAt, locale, timeZone),
        })
      : undefined;
    return {
      id: item.id,
      label: item.label,
      checkedByLine,
      snags: snags
        .filter((snag) => snag.notedHere && snag.checklistItemId === item.id)
        .map(snagView),
      // The trip packet's print stylesheet hides the interactive control
      // this item otherwise renders as (a <button>) — this whole sentence is
      // what survives on the printed sheet, composed here rather than in the
      // client component so word order and the separator stay a locale
      // choice, not a JSX literal's.
      printLine: checkedByLine
        ? t("trips.preDepartureCheck.printLineChecked", {
            label: item.label,
            status: checkedByLine,
          })
        : t("trips.preDepartureCheck.printLineNotChecked", { label: item.label }),
    };
  });
  // This crew's own snags sit inside the fold; once the last line is ticked
  // the list folds away, so the summary keeps counting them (dive-domain N1).
  const ownOpen = snags.filter((snag) => snag.notedHere).length;
  const checkedSummary = t("trips.preDepartureCheck.summary", {
    checked: checklistListItems.filter((item) => item.checkedByLine !== undefined).length,
    total: checklistListItems.length,
  });
  const summaryLine =
    ownOpen > 0
      ? t("trips.preDepartureCheck.summaryWithSnags", { summary: checkedSummary, count: ownOpen })
      : checkedSummary;
  return {
    items: checklistListItems,
    carried: snags.filter((snag) => !snag.notedHere).map(snagView),
    snagActions,
    copy: {
      heading: t("trips.preDepartureCheck.heading"),
      summary: summaryLine,
      errorRefusal: t("trips.preDepartureCheck.errorRefusal"),
      checkedLabel: t("trips.preDepartureCheck.checkedLabel"),
      uncheckedLabel: t("trips.preDepartureCheck.uncheckedLabel"),
      confirmClear: t("trips.preDepartureCheck.confirmClear"),
      snagsHeading: t("trips.preDepartureCheck.snagsHeading"),
      snagFixed: t("trips.preDepartureCheck.snagFixed"),
      snagStillThere: t("trips.preDepartureCheck.snagStillThere"),
      snagSaving: t("trips.preDepartureCheck.snagSaving"),
      noteProblem: t("trips.preDepartureCheck.noteProblem"),
      noteItemLabel: t("trips.preDepartureCheck.noteItemLabel"),
      noteLabel: t("trips.preDepartureCheck.noteLabel"),
      noteSave: t("trips.preDepartureCheck.noteSave"),
      noteRefused: t("trips.preDepartureCheck.noteRefused"),
    },
  };
}
