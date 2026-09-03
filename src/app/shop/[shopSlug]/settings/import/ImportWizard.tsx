"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { ShopNotice, ShopStat } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { fill, pluralForm } from "@/i18n/fill";
import {
  type ImportField,
  type ImportIssueCode,
  type PreparedImport,
  prepareContactImport,
} from "@/lib/import";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type ImportActionErrorCode,
  type ImportActionState,
  importContactsAction,
} from "./actions";

/**
 * Every word this wizard renders, resolved on the server and passed down as
 * plain data — see the note in `src/i18n/staff-messages.ts`. Several of these
 * are ICU-flavored templates (`{name}`, and `{count, plural, one {…} other
 * {…}}`) because the values they interpolate — a parsed CSV's row counts, an
 * import result's summary counts — are only known once this client component
 * runs; `fill()` below resolves them locally, the same syntax `staffTranslator`
 * resolves on the server.
 */
type ImportWizardCopy = {
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
    seeRoster: string;
  };
};

/**
 * One issue's template, choosing the plural form where the sentence counts
 * something.
 *
 * Most issue codes are one fixed sentence; two of them ("N specialty
 * certifications imported…") count. Rather than give every code a `{ one,
 * other }` it does not need, the map holds whichever shape the message is and
 * this picks — through `pluralForm`, which asks `Intl.PluralRules` rather than
 * testing `count === 1`, so a locale with more plural categories than en/es
 * does not silently take the wrong branch.
 */
function issueTemplate(template: string | { one: string; other: string }, count?: number): string {
  return typeof template === "string" ? template : pluralForm(count ?? 0, template);
}

const PREVIEW_LIMIT = 60;
const issueTone: Record<"error" | "warning" | "info", string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-muted",
};

export function ImportWizard({
  diversHref,
  intro,
  copy,
  locale,
}: {
  diversHref: string;
  /** Rendered on the server via `t.rich` for the embedded `contacts.csv` mono span. */
  intro: ReactNode;
  copy: ImportWizardCopy;
  /**
   * The reader's negotiated locale, for the one list this component joins
   * itself. Passed down rather than left to the runtime default, which in a
   * browser is the *device's* language and not the one the page is written in.
   */
  locale: string;
}) {
  const [state, formAction] = useActionState<ImportActionState, FormData>(importContactsAction, {
    status: "idle",
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The whole preview runs in the browser off this input's change event, so a
  // file chosen before hydration is silently dropped. Marked here so a test can
  // wait for the real thing rather than race it (same pattern as the booking
  // party fields).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Import/export is security- and data-sensitive (AGENTS.md). This route has
  // no dynamic id, so if `cacheComponents: true`'s Activity-based navigation
  // is ever re-enabled, a stale parsed preview — and the hidden `csvText` a
  // submit would commit — could otherwise survive a navigate-away-and-back
  // for a file the staffer no longer has open (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8). Clear the whole preview on the leading edge of any
  // (re)navigation, same pattern as InlineConfirm.
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change clears the preview, which is the point.
  useEffect(() => {
    setFileName(null);
    setCsvText("");
    setPrepared(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [pathname]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setPrepared(prepareContactImport(text));
  }

  const showResult = state.status === "done";
  const previewRows = prepared?.rows.slice(0, PREVIEW_LIMIT) ?? [];
  const hiddenRows = (prepared?.rows.length ?? 0) - previewRows.length;

  return (
    <SectionCard padding="lg" title={copy.heading} description={intro}>
      <div className="flex flex-wrap items-center gap-3">
        <label className={buttonClass({ variant: "secondary", className: "cursor-pointer" })}>
          {fileName ? copy.chooseDifferentFile : copy.chooseFile}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            data-hydrated={hydrated ? "true" : "false"}
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {fileName ? <span className="text-sm text-muted">{fileName}</span> : null}
      </div>

      {/* A file this wizard cannot read is a refusal of the control just used,
          not news about the page — so it renders in the chooser's own row
          rather than as a banner (see `FormStatus`, components/ui/form.tsx). */}
      <FormStatus tone="danger" className="mt-3">
        {prepared?.fatal
          ? fill(copy.errors[prepared.fatal.code], prepared.fatal.params ?? {})
          : undefined}
      </FormStatus>

      {prepared && !prepared.fatal ? (
        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            {prepared.mapping.map((entry) => (
              <span
                key={entry.field}
                className="inline-flex items-baseline gap-1.5 rounded-full bg-surface-sunken px-3 py-1 text-xs"
                title={fill(copy.columnTitle, { header: entry.header })}
              >
                <span className="font-medium text-foreground">{copy.fieldLabels[entry.field]}</span>
                <span className="font-mono text-muted">{entry.header}</span>
              </span>
            ))}
          </div>

          {prepared.ignoredMedicalColumns.length > 0 ? (
            <p className="mt-3 text-sm text-warning">
              {fill(copy.ignoredMedicalColumns, {
                columns: prepared.ignoredMedicalColumns.join(", "),
              })}
            </p>
          ) : null}
          {prepared.totals.withWaiver > 0 ? (
            <p className="mt-3 text-sm text-warning">
              {fill(
                pluralForm(prepared.totals.withWaiver, {
                  one: copy.waiverRowsNoticeOne,
                  other: copy.waiverRowsNoticeOther,
                }),
                { count: prepared.totals.withWaiver },
              )}
            </p>
          ) : null}
          {prepared.totals.withVisit > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {fill(
                pluralForm(prepared.totals.withVisit, {
                  one: copy.visitRowsNoticeOne,
                  other: copy.visitRowsNoticeOther,
                }),
                { count: prepared.totals.withVisit },
              )}
            </p>
          ) : null}
          {prepared.totals.withPaymentHistory > 0 ? (
            <p className="mt-3 text-sm text-warning">
              {fill(
                pluralForm(prepared.totals.withPaymentHistory, {
                  one: copy.paymentHistoryRowsNoticeOne,
                  other: copy.paymentHistoryRowsNoticeOther,
                }),
                { count: prepared.totals.withPaymentHistory },
              )}
            </p>
          ) : null}
          {prepared.unmappedColumns.length > 0 ? (
            <p className="mt-1 text-xs text-muted">
              {fill(copy.unmappedColumns, { columns: prepared.unmappedColumns.join(", ") })}
            </p>
          ) : null}

          {/* Seven tiles across a max-w-3xl column wrapped their labels to different
              heights, which knocked the numbers off a shared baseline. Four wide,
              two rows. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: copy.stats.diversInFile, value: prepared.totals.importable },
              // A certification export lists one row per card, so rows that add
              // cards to a diver an earlier row brought in are the norm, not
              // duplicates to explain away.
              { label: copy.stats.extraCardRows, value: prepared.totals.merged },
              { label: copy.stats.skipped, value: prepared.totals.skipped },
              { label: copy.stats.cards, value: prepared.totals.withCard },
              // "Specialties", not "Specialty cards": a two-line label in one
              // tile drops that tile's number below the other five.
              { label: copy.stats.specialties, value: prepared.totals.withSpecialty },
              { label: copy.stats.nitroxCards, value: prepared.totals.withNitrox },
              { label: copy.stats.waivers, value: prepared.totals.withWaiver },
              { label: copy.stats.pastVisits, value: prepared.totals.withVisit },
              { label: copy.stats.paymentHistory, value: prepared.totals.withPaymentHistory },
              ...(prepared.totals.withNotes > 0
                ? [{ label: copy.stats.internalNotes, value: prepared.totals.withNotes }]
                : []),
            ].map((stat) => (
              // `inset`: these tiles sit inside the wizard's own card, so they
              // take the sunken tile rather than stacking card on card.
              <ShopStat
                key={stat.label}
                variant="inset"
                definition
                label={stat.label}
                value={stat.value}
              />
            ))}
          </dl>

          {/* Importing a roster is desk work, but a shop owner who opened the
              confirmation on a phone gets six columns in a 390px window and no
              sign that four of them are off to the right. Same one-line hint the
              public trip page uses over its swipeable briefings — say the
              gesture rather than redesign the table for a screen it isn't for. */}
          <p className="mt-4 text-sm font-medium text-muted sm:hidden">{copy.previewSwipeHint}</p>
          {/* `flush` inside the wizard's card, with a thin border kept as the
              boundary of the sideways-scroll region — but no card-on-card
              shadow or second bg-surface. */}
          <Table
            flush
            minWidth="36rem"
            shellClassName="mt-2 rounded-inset border border-border sm:mt-4"
          >
            <THead>
              <Th numeric>{copy.table.rowNumber}</Th>
              <Th>{copy.table.name}</Th>
              <Th>{copy.table.email}</Th>
              <Th>{copy.table.card}</Th>
              <Th>{copy.table.waiver}</Th>
              <Th>{copy.table.notes}</Th>
            </THead>
            <TBody>
              {previewRows.map((row) => (
                // Quiet ink rather than `opacity-60`: dimming the whole row
                // dimmed its "skipped" chip with it, to 2.81:1 — a row you are
                // being asked to *check* rendered below the floor for reading
                // it (issue #793). `text-muted` is the same signal at a ratio
                // the palette stands behind, and the chip keeps its own colour.
                <tr key={row.rowNumber} className={row.action === "skip" ? "text-muted" : ""}>
                  <Td numeric muted>
                    {row.rowNumber}
                  </Td>
                  <Td>
                    {row.fullName || <span className="text-danger">{copy.table.noName}</span>}
                    {row.action === "skip" ? (
                      <span className="ml-2 rounded bg-danger-tint px-1.5 py-0.5 text-xs text-danger">
                        {copy.table.skippedBadge}
                      </span>
                    ) : null}
                    {row.action === "merge" ? (
                      <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
                        {fill(copy.table.mergedBadge, { row: row.mergedIntoRow ?? "" })}
                      </span>
                    ) : null}
                  </Td>
                  <Td muted>{row.email ?? copy.table.emptyValue}</Td>
                  {/* One row can carry a level card and a specialty card (a
                      certification export lists one card per row, so usually
                      it's one or the other). Both belong here — a specialty
                      showing as "—" would read as "nothing came across". */}
                  <Td muted>
                    {row.cert || row.specialties.length > 0 ? (
                      <span className="flex flex-col gap-0.5">
                        {row.cert ? (
                          <span className="whitespace-nowrap">
                            {fill(copy.table.certLine, {
                              level: row.cert.level.replaceAll("_", " "),
                              status:
                                row.cert.status === "verified"
                                  ? copy.table.certImported
                                  : copy.table.certForReview,
                            })}
                          </span>
                        ) : null}
                        {row.specialties.map((card) => (
                          <span key={card.specialty} className="whitespace-nowrap">
                            {fill(copy.table.specialtyLine, {
                              specialty: card.specialty,
                              status:
                                card.status === "verified"
                                  ? copy.table.certImported
                                  : copy.table.certForReview,
                            })}
                          </span>
                        ))}
                      </span>
                    ) : (
                      copy.table.emptyValue
                    )}
                  </Td>
                  <Td muted>
                    {row.waiver ? (
                      <span className="whitespace-nowrap">{copy.table.waiverAcceptedImported}</span>
                    ) : (
                      copy.table.emptyValue
                    )}
                  </Td>
                  <Td>
                    {row.issues.length === 0 && !row.notes ? (
                      <span className="text-muted">{copy.table.emptyValue}</span>
                    ) : (
                      <div className="space-y-1">
                        {row.notes ? (
                          <p className="text-xs text-foreground/80 line-clamp-2" title={row.notes}>
                            {row.notes}
                          </p>
                        ) : null}
                        {row.issues.length > 0 ? (
                          <ul className="space-y-0.5">
                            {/* The issue list is built once per row by prepareContactImport and
                                never reordered or filtered afterward, so the index is a stable
                                identity — there's no other natural key, since two issues can
                                legitimately share the same code and params (e.g. "agency
                                unrecognized" from both a cert and a specialty column). */}
                            {row.issues.map((issue, index) => (
                              <li
                                // biome-ignore lint/suspicious/noArrayIndexKey: static, unreordered list
                                key={`${issue.code}-${index}`}
                                className={`text-xs ${issueTone[issue.level]}`}
                              >
                                {fill(
                                  issueTemplate(copy.issues[issue.code], issue.params?.count),
                                  issue.params ?? {},
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {hiddenRows > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {fill(
                pluralForm(PREVIEW_LIMIT, {
                  one: copy.hiddenRowsNoticeOne,
                  other: copy.hiddenRowsNoticeOther,
                }),
                { limit: PREVIEW_LIMIT, total: prepared.rows.length },
              )}
            </p>
          ) : null}

          {!showResult ? (
            // The import's own refusal moved inside this form, into the action
            // row beside the button that was pressed: a preview table of up to
            // sixty rows sat between the two, so a banner above it answered a
            // tap the staffer had made a screenful below (see `FormStatus`,
            // components/ui/form.tsx).
            <form action={formAction} className="mt-5 flex flex-wrap items-center gap-3">
              <input type="hidden" name="csv" value={csvText} />
              <SubmitButton
                pendingLabel={copy.submitting}
                disabled={prepared.totals.importable === 0}
                className={buttonClass()}
              >
                {fill(
                  pluralForm(prepared.totals.importable, {
                    one: copy.submitOne,
                    other: copy.submitOther,
                  }),
                  { count: prepared.totals.importable },
                )}
              </SubmitButton>
              <FormStatus tone="danger">
                {state.status === "error"
                  ? fill(copy.errors[state.code], state.params ?? {})
                  : undefined}
              </FormStatus>
            </form>
          ) : null}
        </div>
      ) : null}

      {showResult && state.status === "done" ? (
        <div className="mt-6">
          <ShopNotice tone="success">
            <p className="font-medium">
              {/* Two counts, so two pairs and a template holding only their
                  order — see the same shape on the departure board's boarding
                  line (issue #778). */}
              {fill(copy.result.summary, {
                addedPart: fill(
                  pluralForm(state.summary.peopleCreated, {
                    one: copy.result.summaryAddedOne,
                    other: copy.result.summaryAddedOther,
                  }),
                  { added: state.summary.peopleCreated },
                ),
                updatedPart: fill(
                  pluralForm(state.summary.peopleUpdated, {
                    one: copy.result.summaryUpdatedOne,
                    other: copy.result.summaryUpdatedOther,
                  }),
                  { updated: state.summary.peopleUpdated },
                ),
              })}
            </p>
            <p className="mt-1 text-sm">
              {/* `{cards}` is a *formatted list* ("3 certifications and 1
                  nitrox"), not a count — so the sentence around it agrees with
                  the total across the three, which is the number a Spanish
                  reader hears. At a total of one the list is a single singular
                  phrase and the sentence has to be singular with it. */}
              {fill(
                pluralForm(
                  state.summary.cardsAdded +
                    state.summary.specialtyAdded +
                    state.summary.nitroxAdded,
                  { one: copy.result.cardsLineOne, other: copy.result.cardsLineOther },
                ),
                {
                  cards: cachedListFormat(locale, { style: "long", type: "conjunction" }).format([
                    fill(
                      pluralForm(state.summary.cardsAdded, {
                        one: copy.result.cardsCertificationsOne,
                        other: copy.result.cardsCertificationsOther,
                      }),
                      { count: state.summary.cardsAdded },
                    ),
                    fill(
                      pluralForm(state.summary.specialtyAdded, {
                        one: copy.result.cardsSpecialtyOne,
                        other: copy.result.cardsSpecialtyOther,
                      }),
                      { count: state.summary.specialtyAdded },
                    ),
                    fill(
                      pluralForm(state.summary.nitroxAdded, {
                        one: copy.result.cardsNitroxOne,
                        other: copy.result.cardsNitroxOther,
                      }),
                      { count: state.summary.nitroxAdded },
                    ),
                  ]),
                },
              )}
              {state.summary.rowsMerged > 0
                ? fill(copy.result.rowsMergedNote, { count: state.summary.rowsMerged })
                : ""}
              {state.summary.cardsSkippedExisting +
                state.summary.specialtySkippedExisting +
                state.summary.nitroxSkippedExisting >
              0
                ? fill(copy.result.cardsSkippedNote, {
                    count:
                      state.summary.cardsSkippedExisting +
                      state.summary.specialtySkippedExisting +
                      state.summary.nitroxSkippedExisting,
                  })
                : ""}
              {state.summary.rowsSkipped > 0
                ? fill(copy.result.rowsSkippedNote, { count: state.summary.rowsSkipped })
                : ""}
            </p>
            {/* Never folded into "already on file": that number belongs to a
                different diver, so nothing was written for this one. */}
            {state.summary.cardsHeldByAnotherDiver > 0 ? (
              <p className="mt-1 text-sm">
                {fill(copy.result.cardsHeldByAnother, {
                  count: state.summary.cardsHeldByAnotherDiver,
                })}
              </p>
            ) : null}
            {state.summary.specialtyAdded > 0 ? (
              <p className="mt-1 text-sm">{copy.result.specialtyGateNote}</p>
            ) : null}
            {state.summary.waiversAdded +
              state.summary.waiversSkippedExisting +
              state.summary.waiversSkippedNoTemplate >
            0 ? (
              <p className="mt-1 text-sm">
                {fill(
                  pluralForm(state.summary.waiversAdded, {
                    one: copy.result.waiversLineOne,
                    other: copy.result.waiversLineOther,
                  }),
                  { count: state.summary.waiversAdded },
                )}
                {state.summary.waiversSkippedExisting > 0
                  ? fill(copy.result.waiversSkippedExistingNote, {
                      count: state.summary.waiversSkippedExisting,
                    })
                  : ""}
                {state.summary.waiversSkippedNoTemplate > 0
                  ? fill(
                      pluralForm(state.summary.waiversSkippedNoTemplate, {
                        one: copy.result.waiversSkippedNoTemplateNoteOne,
                        other: copy.result.waiversSkippedNoTemplateNoteOther,
                      }),
                      { count: state.summary.waiversSkippedNoTemplate },
                    )
                  : ""}
                {state.summary.waiverDocumentsFailed > 0
                  ? fill(copy.result.waiverDocumentsFailedNote, {
                      count: state.summary.waiverDocumentsFailed,
                    })
                  : ""}
              </p>
            ) : null}
            {state.summary.visitsAdded + state.summary.visitsSkippedExisting > 0 ? (
              <p className="mt-1 text-sm">
                {fill(
                  pluralForm(state.summary.visitsAdded, {
                    one: copy.result.visitsLineOne,
                    other: copy.result.visitsLineOther,
                  }),
                  { count: state.summary.visitsAdded },
                )}
                {state.summary.visitsSkippedExisting > 0
                  ? fill(copy.result.visitsSkippedNote, {
                      count: state.summary.visitsSkippedExisting,
                    })
                  : ""}
              </p>
            ) : null}
            {state.summary.paymentHistoryAdded + state.summary.paymentHistorySkippedExisting > 0 ? (
              <p className="mt-1 text-sm">
                {fill(
                  pluralForm(state.summary.paymentHistoryAdded, {
                    one: copy.result.paymentHistoryLineOne,
                    other: copy.result.paymentHistoryLineOther,
                  }),
                  { count: state.summary.paymentHistoryAdded },
                )}
                {state.summary.paymentHistorySkippedExisting > 0
                  ? fill(copy.result.paymentHistorySkippedNote, {
                      count: state.summary.paymentHistorySkippedExisting,
                    })
                  : ""}
                {state.summary.receiptDocumentsFailed > 0
                  ? fill(copy.result.receiptDocumentsFailedNote, {
                      count: state.summary.receiptDocumentsFailed,
                    })
                  : ""}
              </p>
            ) : null}
            {state.summary.notesAdded > 0 ? (
              <p className="mt-1 text-sm">
                {fill(
                  pluralForm(state.summary.notesAdded, {
                    one: copy.result.notesLineOne,
                    other: copy.result.notesLineOther,
                  }),
                  { count: state.summary.notesAdded },
                )}
              </p>
            ) : null}
            <Link
              href={diversHref}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
            >
              {copy.result.seeRoster}
            </Link>
          </ShopNotice>
        </div>
      ) : null}
    </SectionCard>
  );
}
