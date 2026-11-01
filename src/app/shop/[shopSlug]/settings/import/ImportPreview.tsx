import { ShopStat } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { fill, pluralForm } from "@/i18n/fill";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { ImportIssue, PreparedImport } from "@/lib/import";
import type { ImportActionState } from "./actions";
import type { ImportWizardCopy } from "./import-wizard-copy";

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

/**
 * One issue's placeholder values, with `field` resolved from the `ImportField`
 * code to the column label this staffer is already reading on the mapping
 * table above. `src/lib/import.ts` emits codes and never words, so the label
 * can only be looked up here, where the translated copy is.
 */
function issueValues(
  copy: ImportWizardCopy,
  params: ImportIssue["params"],
): Record<string, string | number | undefined> {
  if (!params) return {};
  const { field, ...rest } = params;
  return field ? { ...rest, field: copy.fieldLabels[field] } : rest;
}

export const PREVIEW_LIMIT = 60;
const issueTone: Record<"error" | "warning" | "info", string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-muted",
};

/**
 * The parsed file as the staffer is asked to confirm it: the column mapping, the
 * notices, the totals, the first rows, and the import button. Runs in the
 * browser off the wizard's state; it holds none of its own.
 */
export function ImportPreview({
  prepared,
  previewRows,
  hiddenRows,
  copy,
  showResult,
  formAction,
  csvText,
  state,
  assist,
  locale,
}: {
  prepared: PreparedImport;
  previewRows: PreparedImport["rows"];
  hiddenRows: number;
  copy: ImportWizardCopy;
  showResult: boolean;
  formAction: (formData: FormData) => void;
  csvText: string;
  state: ImportActionState;
  /**
   * Claude's mapping for the columns the importer could not read (the
   * `import` assist), as JSON for the confirm to post back, where the server
   * re-reads it; and the words that mark what it suggested.
   */
  assist?: { json: string; suggested: string; pendingCards: string };
  /** The reader's locale, for the dates of bookings after today. */
  locale: string;
}) {
  const anyAssisted = prepared.mapping.some((entry) => entry.assisted);
  // The count is the importer's own total; the rows are only for the list.
  const afterTodayCount = prepared.totals.bookingsAfterToday;
  const listedAfterToday = prepared.rows
    .filter((row) => row.action !== "skip" && row.bookingAfterToday !== null)
    .slice(0, PREVIEW_LIMIT);
  const unlistedAfterToday = afterTodayCount - listedAfterToday.length;
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        {prepared.mapping.map((entry) => (
          <span
            key={entry.field}
            className="inline-flex items-baseline gap-1.5 rounded-full bg-surface-sunken px-3 py-1 text-xs"
            title={fill(copy.columnTitle, { header: entry.header })}
          >
            <span className="font-medium text-foreground">
              {entry.assisted && assist
                ? fill(assist.suggested, { field: copy.fieldLabels[entry.field] })
                : copy.fieldLabels[entry.field]}
            </span>
            <span className="font-mono text-muted">{entry.header}</span>
          </span>
        ))}
      </div>

      {anyAssisted && assist ? (
        <p className="mt-3 text-sm text-muted">{assist.pendingCards}</p>
      ) : null}
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
      {/* Seats sold in the old system for a day that has not come. They are
          not visits and not seats here; each is named so the shop can add it
          on the board or leave it where it was sold until it sails. */}
      {afterTodayCount > 0 ? (
        <div className="mt-3 text-sm">
          <p id="import-bookings-after-today" className="text-warning">
            {fill(
              pluralForm(afterTodayCount, {
                one: copy.bookingsAfterTodayOne,
                other: copy.bookingsAfterTodayOther,
              }),
              { count: afterTodayCount, system: copy.sourceSystem },
            )}
          </p>
          <ul aria-labelledby="import-bookings-after-today" className="mt-1 space-y-0.5 text-muted">
            {listedAfterToday.map((row) => (
              <li key={row.rowNumber}>
                {[
                  row.bookingAfterToday
                    ? formatCalendarDate(row.bookingAfterToday.bookedFor, locale)
                    : null,
                  row.fullName,
                  row.bookingAfterToday?.title,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
          {unlistedAfterToday > 0 ? (
            <p className="mt-1 text-muted">
              {fill(copy.bookingsAfterTodayMore, { count: unlistedAfterToday })}
            </p>
          ) : null}
        </div>
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
          // "Specialties", not "Specialty cards": a two-line label grows
          // the whole row's label band (ShopStat lines the numbers up
          // across it), so the short word keeps the row one line tall.
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
                  <span className="ms-2 rounded bg-danger-tint px-1.5 py-0.5 text-xs text-danger">
                    {copy.table.skippedBadge}
                  </span>
                ) : null}
                {row.action === "merge" ? (
                  <span className="ms-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
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
                              issueValues(copy, issue.params),
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
          {assist && anyAssisted ? <input type="hidden" name="assist" value={assist.json} /> : null}
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
  );
}
