"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { type ImportField, type PreparedImport, prepareContactImport } from "@/lib/import";
import { type ImportActionState, importContactsAction } from "./actions";

const FIELD_LABELS: Record<ImportField, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency phone",
  certification_agency: "Cert agency",
  certification_level: "Cert level",
  certification_number: "Cert number",
  certification_status: "Cert status",
  nitrox_certified: "Nitrox",
  nitrox_certification_number: "Nitrox number",
  bcd_size: "BCD size",
  wetsuit_size: "Wetsuit size",
  boot_size: "Boot size",
  fin_size: "Fin size",
};

const PREVIEW_LIMIT = 60;
const issueTone: Record<"error" | "warning" | "info", string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-muted",
};

export function ImportWizard({ diversHref }: { diversHref: string }) {
  const [state, formAction] = useActionState<ImportActionState, FormData>(importContactsAction, {
    status: "idle",
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <h2 className="text-lg font-semibold">Upload a contacts file</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        A CSV from your old system, or DiveDay's own <span className="font-mono">contacts.csv</span>{" "}
        from the data export. Rows with an email are matched to your existing divers, so
        re-importing one updates that diver instead of duplicating them; rows without an email
        always come in as new records. Nothing is written until you review the preview and confirm.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label
          className={buttonClass({ variant: "secondary", size: "lg", className: "cursor-pointer" })}
        >
          {fileName ? "Choose a different file" : "Choose CSV file"}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
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
                title={`Column “${entry.header}”`}
              >
                <span className="font-medium text-foreground">{FIELD_LABELS[entry.field]}</span>
                <span className="font-mono text-muted">{entry.header}</span>
              </span>
            ))}
          </div>

          {prepared.ignoredMedicalColumns.length > 0 ? (
            <p className="mt-3 text-sm text-warning">
              Left behind on purpose: {prepared.ignoredMedicalColumns.join(", ")}. Medical and
              health answers are never imported — collect a fresh signed waiver in DiveDay.
            </p>
          ) : null}
          {prepared.unmappedColumns.length > 0 ? (
            <p className="mt-1 text-xs text-muted">
              Not recognized, so ignored: {prepared.unmappedColumns.join(", ")}.
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Will import", value: prepared.totals.importable },
              { label: "Skipped", value: prepared.totals.skipped },
              { label: "Claimed cards", value: prepared.totals.withCard },
              { label: "Nitrox cards", value: prepared.totals.withNitrox },
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
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Card</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
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
                      {row.fullName || <span className="text-danger">— no name —</span>}
                      {row.action === "skip" ? (
                        <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">
                          skipped
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{row.email ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">
                      {row.cert ? (
                        <span className="whitespace-nowrap">
                          {row.cert.level.replaceAll("_", " ")} · claimed
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.issues.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {row.issues.map((issue) => (
                            <li key={issue.message} className={`text-xs ${issueTone[issue.level]}`}>
                              {issue.message}
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
              Showing the first {PREVIEW_LIMIT} rows. All {prepared.rows.length} are imported on
              confirm.
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
                pendingLabel="Importing…"
                disabled={prepared.totals.importable === 0}
                className={buttonClass({ size: "lg" })}
              >
                {prepared.totals.importable === 1
                  ? "Import 1 contact"
                  : `Import ${prepared.totals.importable} contacts`}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {showResult && state.status === "done" ? (
        <div className="mt-6">
          <ShopNotice tone="success">
            <p className="font-medium">
              Imported. {state.summary.peopleCreated} added, {state.summary.peopleUpdated} updated.
            </p>
            <p className="mt-1 text-sm">
              {state.summary.cardsAdded} card{state.summary.cardsAdded === 1 ? "" : "s"} and{" "}
              {state.summary.nitroxAdded} nitrox card
              {state.summary.nitroxAdded === 1 ? "" : "s"} added as claimed — verify each at first
              contact.
              {state.summary.cardsSkippedExisting + state.summary.nitroxSkippedExisting > 0
                ? ` ${state.summary.cardsSkippedExisting + state.summary.nitroxSkippedExisting} card(s) already on file were left untouched.`
                : ""}
              {state.summary.rowsSkipped > 0 ? ` ${state.summary.rowsSkipped} row(s) skipped.` : ""}
            </p>
            <Link
              href={diversHref}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
            >
              See the roster
            </Link>
          </ShopNotice>
        </div>
      ) : null}
    </section>
  );
}
