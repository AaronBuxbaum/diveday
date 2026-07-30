"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  type ImportField,
  type ImportIssueCode,
  type PreparedImport,
  prepareContactImport,
} from "@/lib/import";
import { type ImportActionState, importContactsAction } from "./actions";

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
  waiverRowsNotice: string;
  visitRowsNotice: string;
  stats: {
    diversInFile: string;
    extraCardRows: string;
    skipped: string;
    cards: string;
    specialties: string;
    nitroxCards: string;
    waivers: string;
    pastVisits: string;
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
  hiddenRowsNotice: string;
  submit: string;
  submitting: string;
  /** Every `ImportIssueCode` `src/lib/import.ts` can raise, resolved to its raw ICU
   * template — `fill()` interpolates each issue's `params` once the row is known
   * (only client-side, since the CSV preview never touches the server). */
  issues: Record<ImportIssueCode, string>;
  result: {
    summary: string;
    cardsLine: string;
    rowsMergedNote: string;
    cardsSkippedNote: string;
    rowsSkippedNote: string;
    cardsHeldByAnother: string;
    specialtyGateNote: string;
    waiversLine: string;
    waiversSkippedExistingNote: string;
    waiversSkippedNoTemplateNote: string;
    waiverDocumentsFailedNote: string;
    visitsLine: string;
    visitsSkippedNote: string;
    seeRoster: string;
  };
};

/**
 * Minimal ICU-subset formatter for copy that arrives as plain strings — a
 * translator function may never cross the Server→Client boundary (see
 * AGENTS.md). Supports "{name}" substitution and
 * "{name, plural, one {…} other {…}}" with "#" standing for the plural value,
 * matching the ICU syntax `staffTranslator` already resolves server-side.
 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(
    /\{(\w+)(?:,\s*plural,\s*((?:\w+\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*)+))?\}/g,
    (match, name: string, pluralBranches: string | undefined) => {
      if (pluralBranches === undefined) {
        const value = values[name];
        return value !== undefined ? String(value) : match;
      }
      const count = Number(values[name]);
      const branches: Record<string, string> = {};
      const branchRe = /(\w+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
      let branchMatch: RegExpExecArray | null = branchRe.exec(pluralBranches);
      while (branchMatch) {
        branches[branchMatch[1]] = branchMatch[2];
        branchMatch = branchRe.exec(pluralBranches);
      }
      const branch = (count === 1 ? branches.one : undefined) ?? branches.other ?? "";
      return branch.replace(/#/g, String(count));
    },
  );
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
}: {
  diversHref: string;
  /** Rendered on the server via `t.rich` for the embedded `contacts.csv` mono span. */
  intro: ReactNode;
  copy: ImportWizardCopy;
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
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">{copy.heading}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label
          className={buttonClass({ variant: "secondary", size: "lg", className: "cursor-pointer" })}
        >
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

      {prepared?.fatal ? (
        <div className="mt-4">
          <ShopNotice tone="danger" role="alert">
            {prepared.fatal}
          </ShopNotice>
        </div>
      ) : null}

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
              {fill(copy.waiverRowsNotice, { count: prepared.totals.withWaiver })}
            </p>
          ) : null}
          {prepared.totals.withVisit > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {fill(copy.visitRowsNotice, { count: prepared.totals.withVisit })}
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
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-surface-sunken px-4 py-3">
                <dt className="text-xs text-muted">{stat.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums text-foreground">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-surface-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{copy.table.rowNumber}</th>
                  <th className="px-3 py-2 font-medium">{copy.table.name}</th>
                  <th className="px-3 py-2 font-medium">{copy.table.email}</th>
                  <th className="px-3 py-2 font-medium">{copy.table.card}</th>
                  <th className="px-3 py-2 font-medium">{copy.table.waiver}</th>
                  <th className="px-3 py-2 font-medium">{copy.table.notes}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`border-t border-border align-top ${row.action === "skip" ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-2 tabular-nums text-muted">{row.rowNumber}</td>
                    <td className="px-3 py-2">
                      {row.fullName || <span className="text-danger">{copy.table.noName}</span>}
                      {row.action === "skip" ? (
                        <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">
                          {copy.table.skippedBadge}
                        </span>
                      ) : null}
                      {row.action === "merge" ? (
                        <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
                          {fill(copy.table.mergedBadge, { row: row.mergedIntoRow ?? "" })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{row.email ?? copy.table.emptyValue}</td>
                    {/* One row can carry a level card and a specialty card (a
                        certification export lists one card per row, so usually
                        it's one or the other). Both belong here — a specialty
                        showing as "—" would read as "nothing came across". */}
                    <td className="px-3 py-2 text-muted">
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
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {row.waiver ? (
                        <span className="whitespace-nowrap">
                          {copy.table.waiverAcceptedImported}
                        </span>
                      ) : (
                        copy.table.emptyValue
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.issues.length === 0 ? (
                        <span className="text-muted">{copy.table.emptyValue}</span>
                      ) : (
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
                                copy.issues[issue.code],
                                (issue.params ?? {}) as unknown as Record<string, string | number>,
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hiddenRows > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {fill(copy.hiddenRowsNotice, {
                limit: PREVIEW_LIMIT,
                total: prepared.rows.length,
              })}
            </p>
          ) : null}

          {state.status === "error" ? (
            <div className="mt-4">
              <ShopNotice tone="danger" role="alert">
                {state.message}
              </ShopNotice>
            </div>
          ) : null}

          {!showResult ? (
            <form action={formAction} className="mt-5">
              <input type="hidden" name="csv" value={csvText} />
              <SubmitButton
                pendingLabel={copy.submitting}
                disabled={prepared.totals.importable === 0}
                className={buttonClass({ size: "lg" })}
              >
                {fill(copy.submit, { count: prepared.totals.importable })}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {showResult && state.status === "done" ? (
        <div className="mt-6">
          <ShopNotice tone="success">
            <p className="font-medium">
              {fill(copy.result.summary, {
                added: state.summary.peopleCreated,
                updated: state.summary.peopleUpdated,
              })}
            </p>
            <p className="mt-1 text-sm">
              {fill(copy.result.cardsLine, {
                cardsAdded: state.summary.cardsAdded,
                specialtyAdded: state.summary.specialtyAdded,
                nitroxAdded: state.summary.nitroxAdded,
              })}
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
                {fill(copy.result.waiversLine, { count: state.summary.waiversAdded })}
                {state.summary.waiversSkippedExisting > 0
                  ? fill(copy.result.waiversSkippedExistingNote, {
                      count: state.summary.waiversSkippedExisting,
                    })
                  : ""}
                {state.summary.waiversSkippedNoTemplate > 0
                  ? fill(copy.result.waiversSkippedNoTemplateNote, {
                      count: state.summary.waiversSkippedNoTemplate,
                    })
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
                {fill(copy.result.visitsLine, { count: state.summary.visitsAdded })}
                {state.summary.visitsSkippedExisting > 0
                  ? fill(copy.result.visitsSkippedNote, {
                      count: state.summary.visitsSkippedExisting,
                    })
                  : ""}
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
    </section>
  );
}
