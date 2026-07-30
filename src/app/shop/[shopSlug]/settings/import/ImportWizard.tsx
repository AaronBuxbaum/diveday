"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
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
  date_of_birth: "Date of birth",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency phone",
  dive_insurance: "Dive insurance",
  certification_agency: "Cert agency",
  certification_level: "Cert level",
  certification_number: "Cert number",
  certification_status: "Cert status",
  certification_expires_at: "Refresher due",
  specialty: "Specialty",
  specialty_certification_number: "Specialty number",
  nitrox_certified: "Nitrox",
  nitrox_certification_number: "Nitrox number",
  bcd_size: "BCD size",
  wetsuit_size: "Wetsuit size",
  boot_size: "Boot size",
  fin_size: "Fin size",
  waiver_accepted: "Waiver accepted",
  waiver_signed_at: "Waiver signed",
  waiver_source_name: "Waiver source",
  waiver_document_url: "Waiver document",
  medical_document_url: "Medical document",
  visit_date: "Past visit date",
  visit_title: "Past visit",
  visit_status: "Past visit status",
  visit_amount: "Past visit amount",
  visit_reference: "Booking reference",
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
                title={`Column “${entry.header}”`}
              >
                <span className="font-medium text-foreground">{FIELD_LABELS[entry.field]}</span>
                <span className="font-mono text-muted">{entry.header}</span>
              </span>
            ))}
          </div>

          {prepared.ignoredMedicalColumns.length > 0 ? (
            <p className="mt-3 text-sm text-warning">
              Left behind on purpose: {prepared.ignoredMedicalColumns.join(", ")}. These weren't
              recognized as a waiver column, so their contents never import — individual medical
              answers are never reconstructed from another system. A recognized “waiver accepted”
              column is trusted instead; see below.
            </p>
          ) : null}
          {prepared.totals.withWaiver > 0 ? (
            <p className="mt-3 text-sm text-warning">
              {prepared.totals.withWaiver} row{prepared.totals.withWaiver === 1 ? "" : "s"} claim a
              waiver already accepted at a prior shop. DiveDay trusts that — including its medical
              clearance — and marks the record “imported” so it's never confused with a release
              signed here. See “What comes across” above.
            </p>
          ) : null}
          {prepared.totals.withVisit > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {prepared.totals.withVisit} row{prepared.totals.withVisit === 1 ? "" : "s"} record a
              past visit. Those come across as history on the diver's profile — what was booked,
              when, and what your old system called it — and nothing more: they never become trips
              on your schedule, never count toward capacity or reporting, and a booking is not proof
              anyone dived.
            </p>
          ) : null}
          {prepared.unmappedColumns.length > 0 ? (
            <p className="mt-1 text-xs text-muted">
              Not recognized, so ignored: {prepared.unmappedColumns.join(", ")}.
            </p>
          ) : null}

          {/* Seven tiles across a max-w-3xl column wrapped their labels to different
              heights, which knocked the numbers off a shared baseline. Four wide,
              two rows. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Divers in file", value: prepared.totals.importable },
              // A certification export lists one row per card, so rows that add
              // cards to a diver an earlier row brought in are the norm, not
              // duplicates to explain away.
              { label: "Extra card rows", value: prepared.totals.merged },
              { label: "Skipped", value: prepared.totals.skipped },
              { label: "Cards", value: prepared.totals.withCard },
              // "Specialties", not "Specialty cards": a two-line label in one
              // tile drops that tile's number below the other five.
              { label: "Specialties", value: prepared.totals.withSpecialty },
              { label: "Nitrox cards", value: prepared.totals.withNitrox },
              { label: "Waivers", value: prepared.totals.withWaiver },
              { label: "Past visits", value: prepared.totals.withVisit },
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
                  <th className="px-3 py-2 font-medium">Waiver</th>
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
                      {row.action === "merge" ? (
                        <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
                          same diver as row {row.mergedIntoRow}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{row.email ?? "—"}</td>
                    {/* One row can carry a level card and a specialty card (a
                        certification export lists one card per row, so usually
                        it's one or the other). Both belong here — a specialty
                        showing as "—" would read as "nothing came across". */}
                    <td className="px-3 py-2 text-muted">
                      {row.cert || row.specialties.length > 0 ? (
                        <span className="flex flex-col gap-0.5">
                          {row.cert ? (
                            <span className="whitespace-nowrap">
                              {row.cert.level.replaceAll("_", " ")} ·{" "}
                              {row.cert.status === "verified" ? "imported" : "for review"}
                            </span>
                          ) : null}
                          {row.specialties.map((card) => (
                            <span key={card.specialty} className="whitespace-nowrap">
                              {card.specialty} specialty ·{" "}
                              {card.status === "verified" ? "imported" : "for review"}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {row.waiver ? (
                        <span className="whitespace-nowrap">accepted · imported</span>
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
              {state.summary.cardsAdded} card{state.summary.cardsAdded === 1 ? "" : "s"},{" "}
              {state.summary.specialtyAdded} specialty card
              {state.summary.specialtyAdded === 1 ? "" : "s"}, and {state.summary.nitroxAdded}{" "}
              nitrox card
              {state.summary.nitroxAdded === 1 ? "" : "s"} imported and flagged imported, with a
              one-tap confirm on each diver's record.
              {state.summary.rowsMerged > 0
                ? ` ${state.summary.rowsMerged} row(s) added cards to a diver an earlier row brought in.`
                : ""}
              {state.summary.cardsSkippedExisting +
                state.summary.specialtySkippedExisting +
                state.summary.nitroxSkippedExisting >
              0
                ? ` ${state.summary.cardsSkippedExisting + state.summary.specialtySkippedExisting + state.summary.nitroxSkippedExisting} card(s) already on those divers' records were left untouched.`
                : ""}
              {state.summary.rowsSkipped > 0 ? ` ${state.summary.rowsSkipped} row(s) skipped.` : ""}
            </p>
            {/* Never folded into "already on file": that number belongs to a
                different diver, so nothing was written for this one. */}
            {state.summary.cardsHeldByAnotherDiver > 0 ? (
              <p className="mt-1 text-sm">
                {state.summary.cardsHeldByAnotherDiver} card number(s) in the file are already on a
                different diver in your shop, so those cards were not added to anyone. Check the
                file for a repeated number, then enter those cards by hand.
              </p>
            ) : null}
            {state.summary.specialtyAdded > 0 ? (
              <p className="mt-1 text-sm">
                A dive that requires one of those specialties waits on that confirm — tap it on the
                diver's record and the gate opens.
              </p>
            ) : null}
            {state.summary.waiversAdded +
              state.summary.waiversSkippedExisting +
              state.summary.waiversSkippedNoTemplate >
            0 ? (
              <p className="mt-1 text-sm">
                {state.summary.waiversAdded} waiver
                {state.summary.waiversAdded === 1 ? "" : "s"} imported as accepted, marked
                “imported” on the diver's profile.
                {state.summary.waiversSkippedExisting > 0
                  ? ` ${state.summary.waiversSkippedExisting} diver(s) already had a current waiver on file, left untouched.`
                  : ""}
                {state.summary.waiversSkippedNoTemplate > 0
                  ? ` ${state.summary.waiversSkippedNoTemplate} skipped — set up a waiver template first.`
                  : ""}
                {state.summary.waiverDocumentsFailed > 0
                  ? ` ${state.summary.waiverDocumentsFailed} document link(s) didn't fetch and were left off the record.`
                  : ""}
              </p>
            ) : null}
            {state.summary.visitsAdded + state.summary.visitsSkippedExisting > 0 ? (
              <p className="mt-1 text-sm">
                {state.summary.visitsAdded} past visit
                {state.summary.visitsAdded === 1 ? "" : "s"} added to divers' shop history.
                {state.summary.visitsSkippedExisting > 0
                  ? ` ${state.summary.visitsSkippedExisting} were already imported and were left as they are — re-running the same export doesn't double anyone's history.`
                  : ""}
              </p>
            ) : null}
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
