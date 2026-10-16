import type { ImportField, ImportIssueCode } from "@/lib/import";
import type { ImportActionErrorCode } from "./actions";

/**
 * Every word this wizard renders, resolved on the server and passed down as
 * plain data — see the note in `src/i18n/staff-messages.ts`. Several of these
 * are ICU-flavored templates (`{name}`, and `{count, plural, one {…} other
 * {…}}`) because the values they interpolate — a parsed CSV's row counts, an
 * import result's summary counts — are only known once this client component
 * runs; `fill()` below resolves them locally, the same syntax `staffTranslator`
 * resolves on the server.
 */
export type ImportWizardCopy = {
  heading: string;
  chooseFile: string;
  chooseDifferentFile: string;
  columnTitle: string;
  fieldLabels: Record<ImportField, string>;
  ignoredMedicalColumns: string;
  unmappedColumns: string;
  waiverRowsNoticeOne: string;
  waiverRowsNoticeOther: string;
  visitRowsNoticeOne: string;
  visitRowsNoticeOther: string;
  paymentHistoryRowsNoticeOne: string;
  paymentHistoryRowsNoticeOther: string;
  stats: {
    diversInFile: string;
    extraCardRows: string;
    skipped: string;
    cards: string;
    specialties: string;
    nitroxCards: string;
    waivers: string;
    pastVisits: string;
    paymentHistory: string;
    internalNotes: string;
  };
  table: {
    rowNumber: string;
    name: string;
    email: string;
    card: string;
    waiver: string;
    notes: string;
    noName: string;
    skippedBadge: string;
    mergedBadge: string;
    certImported: string;
    certForReview: string;
    certLine: string;
    specialtyLine: string;
    waiverAcceptedImported: string;
    emptyValue: string;
  };
  /** Phone-only: the preview's six columns scroll sideways, so say so. */
  previewSwipeHint: string;
  hiddenRowsNoticeOne: string;
  hiddenRowsNoticeOther: string;
  submitOne: string;
  submitOther: string;
  submitting: string;
  /** Every `ImportIssueCode` `src/lib/import.ts` can raise, resolved to its raw ICU
   * template — `fill()` interpolates each issue's `params` once the row is known
   * (only client-side, since the CSV preview never touches the server). */
  /**
   * One template per issue code, or a `{ one, other }` pair where the sentence
   * counts something. It cannot be a single ICU string: staff copy crosses to
   * the client unformatted (`t.raw`) and is resolved here by `fill()`, a plain
   * `{name}` replace that would print an ICU plural's source verbatim.
   */
  issues: Record<ImportIssueCode, string | { one: string; other: string }>;
  /**
   * Every `ImportActionErrorCode` — both the client-computed `prepared.fatal`
   * (before submit) and the server action's `state` (after submit) resolve
   * through this one map, since the action passes `prepared.fatal`'s own code
   * straight through unchanged.
   */
  errors: Record<ImportActionErrorCode, string>;
  result: {
    summary: string;
    summaryAddedOne: string;
    summaryAddedOther: string;
    summaryUpdatedOne: string;
    summaryUpdatedOther: string;
    cardsLineOne: string;
    cardsLineOther: string;
    cardsCertificationsOne: string;
    cardsCertificationsOther: string;
    cardsSpecialtyOne: string;
    cardsSpecialtyOther: string;
    cardsNitroxOne: string;
    cardsNitroxOther: string;
    rowsMergedNote: string;
    cardsSkippedNote: string;
    rowsSkippedNote: string;
    cardsHeldByAnother: string;
    specialtyGateNote: string;
    waiversLineOne: string;
    waiversLineOther: string;
    waiversSkippedExistingNote: string;
    waiversSkippedNoTemplateNoteOne: string;
    waiversSkippedNoTemplateNoteOther: string;
    waiverDocumentsFailedNote: string;
    visitsLineOne: string;
    visitsLineOther: string;
    visitsSkippedNote: string;
    paymentHistoryLineOne: string;
    paymentHistoryLineOther: string;
    paymentHistorySkippedNote: string;
    receiptDocumentsFailedNote: string;
    notesLineOne: string;
    notesLineOther: string;
    sizesDeclinedLineOne: string;
    sizesDeclinedLineOther: string;
    seeRoster: string;
  };
};
