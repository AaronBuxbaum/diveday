// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_FIELDS, type ImportField, type ImportIssueCode } from "@/lib/import";
import type { ImportActionErrorCode } from "./actions";
import { ImportWizard } from "./ImportWizard";

// Import/export is security- and data-sensitive (AGENTS.md) — this is the
// case the reset-on-revisit fix guards: a stale parsed CSV preview surviving
// a navigate-away-and-back could get committed for a file the staffer no
// longer has open. `usePathname()` is what ImportWizard keys that reset on
// (see the component's own doc comment). `setMockPathname` simulates a
// navigation event — including an Activity-preserved show/hide cycle,
// should `cacheComponents: true` be re-enabled — without a real Next.js
// router.
const { usePathname, setMockPathname } = vi.hoisted(() => {
  let current = "/shop/blue-mantis/settings/import";
  return {
    usePathname: vi.fn(() => current),
    setMockPathname: (next: string) => {
      current = next;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname }));

// The wizard's own server action — never invoked in this test, and its
// module pulls in the DB layer, so it's stubbed rather than imported for real.
vi.mock("./actions", () => ({ importContactsAction: vi.fn() }));

afterEach(() => {
  cleanup();
  setMockPathname("/shop/blue-mantis/settings/import");
});

const ISSUE_CODES: ImportIssueCode[] = [
  "email_invalid",
  "expiry_unreadable",
  "expiry_assumed_month_first",
  "card_marked_unverified",
  "specialty_not_gated",
  "specialty_no_card_number",
  "specialty_imported_verified",
  "specialty_imported_pending",
  "agency_unrecognized",
  "level_names_specialty",
  "level_is_technical",
  "level_not_gated",
  "level_no_card_number",
  "cert_imported_verified",
  "cert_imported_pending",
  "nitrox_imported",
  "nitrox_no_card_number",
  "waiver_date_invalid",
  "waiver_imported",
  "dob_invalid",
  "visit_date_unreadable",
  "visit_no_reference",
  "visit_no_date",
  "payment_history_date_unreadable",
  "payment_history_no_date",
  "no_name",
  "merged_duplicate",
  "no_email_new_record",
];

const ERROR_CODES: ImportActionErrorCode[] = [
  "file_too_large",
  "file_empty",
  "too_many_columns",
  "too_many_rows",
  "cell_too_long_header",
  "cell_too_long_row",
  "no_name_column",
  "not_owner_or_manager",
  "csv_required",
  "no_importable_rows",
];

const COPY = {
  heading: "Import contacts",
  chooseFile: "Choose a file",
  chooseDifferentFile: "Choose a different file",
  columnTitle: "Column: {header}",
  fieldLabels: Object.fromEntries(IMPORT_FIELDS.map((field) => [field, field])) as Record<
    ImportField,
    string
  >,
  ignoredMedicalColumns: "Ignored medical columns: {columns}",
  unmappedColumns: "Unmapped columns: {columns}",
  waiverRowsNotice: "{count} rows carry a waiver",
  visitRowsNotice: "{count} rows carry a past visit",
  paymentHistoryRowsNotice: "{count} rows carry payment history",
  stats: {
    diversInFile: "Divers in file",
    extraCardRows: "Extra card rows",
    skipped: "Skipped",
    cards: "Cards",
    specialties: "Specialties",
    nitroxCards: "Nitrox cards",
    waivers: "Waivers",
    pastVisits: "Past visits",
    paymentHistory: "Payment history",
    internalNotes: "Internal notes",
  },
  table: {
    rowNumber: "Row",
    name: "Name",
    email: "Email",
    card: "Card",
    waiver: "Waiver",
    notes: "Notes",
    noName: "No name",
    skippedBadge: "Skipped",
    mergedBadge: "Merged into row {row}",
    certImported: "Imported",
    certForReview: "For review",
    certLine: "{level} ({status})",
    specialtyLine: "{specialty} ({status})",
    waiverAcceptedImported: "Accepted (imported)",
    emptyValue: "—",
  },
  previewSwipeHint: "Swipe the table to see every column",
  hiddenRowsNotice: "Showing {limit} of {total} rows",
  submit: "Import {count} divers",
  submitting: "Importing…",
  issues: Object.fromEntries(ISSUE_CODES.map((code) => [code, code])) as Record<
    ImportIssueCode,
    string
  >,
  errors: Object.fromEntries(ERROR_CODES.map((code) => [code, code])) as Record<
    ImportActionErrorCode,
    string
  >,
  result: {
    summary: "Added {added}, updated {updated}",
    cardsLine: "Cards added: {cardsAdded}",
    rowsMergedNote: " ({count} merged)",
    cardsSkippedNote: " ({count} skipped)",
    rowsSkippedNote: " ({count} rows skipped)",
    cardsHeldByAnother: "{count} cards already held by another diver",
    specialtyGateNote: "Specialty cards need review",
    waiversLine: "Waivers added: {count}",
    waiversSkippedExistingNote: " ({count} already on file)",
    waiversSkippedNoTemplateNote: " ({count} no template)",
    waiverDocumentsFailedNote: " ({count} documents failed)",
    visitsLine: "Visits added: {count}",
    visitsSkippedNote: " ({count} already on file)",
    paymentHistoryLine: "Payment history added: {count}",
    paymentHistorySkippedNote: " ({count} already on file)",
    receiptDocumentsFailedNote: " ({count} receipt documents failed)",
    notesLine: "Notes added: {count}",
    seeRoster: "See roster",
  },
};

const CSV = "full_name,email\nJane Diver,jane@example.com\n";

function chooseFile(input: HTMLElement, text: string, name = "contacts.csv") {
  const file = new File([text], name, { type: "text/csv" });
  return userEvent.upload(input, file);
}

describe("ImportWizard reset on revisit", () => {
  it("clears the parsed CSV preview on a pathname change, instead of a stale preview surviving to be committed", async () => {
    const { rerender } = render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
      />,
    );

    const input = screen.getByLabelText(/choose a file/i, { selector: "input" });
    await chooseFile(input, CSV);

    await waitFor(() => {
      expect(screen.getByText("Divers in file")).toBeInTheDocument();
    });
    expect(screen.getByText("contacts.csv")).toBeInTheDocument();

    // Simulate a navigate-away-and-back: the pathname changes and this
    // instance's effects re-run (an Activity re-show, should cacheComponents
    // be re-enabled, behaves like a fresh mount for effects, even though
    // state survived) — the import route has no dynamic id to key a fresh
    // instance by otherwise.
    setMockPathname("/shop/blue-mantis/settings/import?foo=bar");
    rerender(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
      />,
    );

    expect(screen.queryByText("Divers in file")).not.toBeInTheDocument();
    expect(screen.queryByText("contacts.csv")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
  });
});
