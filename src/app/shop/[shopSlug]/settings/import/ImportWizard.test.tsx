// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMPORT_FIELDS,
  type ImportAssist,
  type ImportField,
  type ImportIssueCode,
} from "@/lib/import";
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
  "nitrox_imported_verified",
  "nitrox_imported_pending",
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
  "size_too_long",
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
  waiverRowsNoticeOne: "{count} row carries a waiver",
  waiverRowsNoticeOther: "{count} rows carry a waiver",
  visitRowsNoticeOne: "{count} row carries a past visit",
  visitRowsNoticeOther: "{count} rows carry a past visit",
  paymentHistoryRowsNoticeOne: "{count} row carries payment history",
  paymentHistoryRowsNoticeOther: "{count} rows carry payment history",
  bookingsAfterTodayOne: "{count} booking is after today. Keep it in {system}.",
  bookingsAfterTodayOther: "{count} bookings are after today. Keep them in {system}.",
  bookingsAfterTodayMore: "And {count} more.",
  sourceSystem: "FareHarbor",
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
  hiddenRowsNoticeOne: "Showing {limit} of {total} row",
  hiddenRowsNoticeOther: "Showing {limit} of {total} rows",
  submitOne: "Import {count} diver",
  submitOther: "Import {count} divers",
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
    summary: "{addedPart}, {updatedPart}",
    summaryAddedOne: "Added {added}",
    summaryAddedOther: "Added {added}",
    summaryUpdatedOne: "updated {updated}",
    summaryUpdatedOther: "updated {updated}",
    cardsLineOne: "Card added: {cards}",
    cardsLineOther: "Cards added: {cards}",
    cardsCertificationsOne: "{count} certification",
    cardsCertificationsOther: "{count} certifications",
    cardsSpecialtyOne: "{count} specialty",
    cardsSpecialtyOther: "{count} specialties",
    cardsNitroxOne: "{count} nitrox",
    cardsNitroxOther: "{count} nitrox",
    rowsMergedNote: " ({count} merged)",
    cardsSkippedNote: " ({count} skipped)",
    rowsSkippedNote: " ({count} rows skipped)",
    cardsHeldByAnother: "{count} cards already held by another diver",
    specialtyGateNote: "Specialty cards need review",
    waiversLineOne: "Waiver added: {count}",
    waiversLineOther: "Waivers added: {count}",
    waiversSkippedExistingNote: " ({count} already on file)",
    waiversSkippedNoTemplateNoteOne: " ({count} no template)",
    waiversSkippedNoTemplateNoteOther: " ({count} no template)",
    waiverDocumentsFailedNote: " ({count} documents failed)",
    visitsLineOne: "Visit added: {count}",
    visitsLineOther: "Visits added: {count}",
    visitsSkippedNote: " ({count} already on file)",
    paymentHistoryLineOne: "Payment history added: {count}",
    paymentHistoryLineOther: "Payment history added: {count}",
    paymentHistorySkippedNote: " ({count} already on file)",
    receiptDocumentsFailedNote: " ({count} receipt documents failed)",
    notesLineOne: "Note added: {count}",
    notesLineOther: "Notes added: {count}",
    sizesDeclinedLineOne: "Size kept as a note: {count}",
    sizesDeclinedLineOther: "Sizes kept as notes: {count}",
    seeRoster: "See roster",
  },
};

const CSV = "full_name,email\nJane Diver,jane@example.com\n";

function chooseFile(input: HTMLElement, text: string, name = "contacts.csv") {
  const file = new File([text], name, { type: "text/csv" });
  return userEvent.upload(input, file);
}

describe("a row's issues", () => {
  it("names the column an issue is about, in the words the mapping table uses", async () => {
    // `src/lib/import.ts` emits codes and never words, so an issue that is
    // about one column carries the `ImportField` and the label is resolved
    // here (`dive-domain-expert` review). Rendering the code itself would put
    // `wetsuit_size` on a staffer's screen.
    const copy = {
      ...COPY,
      fieldLabels: { ...COPY.fieldLabels, wetsuit_size: "Wetsuit size" },
      issues: { ...COPY.issues, size_too_long: "{field} “{value}” is too long." },
    };
    render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={copy}
        locale="en-US"
        timeZone="America/New_York"
      />,
    );

    const input = screen.getByLabelText(/choose a file/i, { selector: "input" });
    await chooseFile(
      input,
      'full_name,wetsuit_size\nOverlong Olive,"Medium Large, long torso, prefers 5mm not 3mm"\n',
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          /Wetsuit size “Medium Large, long torso, prefers 5mm not 3mm” is too long/,
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("ImportWizard reset on revisit", () => {
  it("clears the parsed CSV preview on a pathname change, instead of a stale preview surviving to be committed", async () => {
    const { rerender } = render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
        locale="en-US"
        timeZone="America/New_York"
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
        locale="en-US"
        timeZone="America/New_York"
      />,
    );

    expect(screen.queryByText("Divers in file")).not.toBeInTheDocument();
    expect(screen.queryByText("contacts.csv")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
  });
});

describe("bookings after today", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says how many, names the old system, and lists each one with its date and trip", async () => {
    // The browser's today, read through the clock in the shop's zone: 03:00
    // UTC on Oct 23 is still Oct 22 in Key Largo, so a booking on the 23rd
    // has not sailed.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-10-23T03:00:00Z");
    render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
        locale="en-US"
        timeZone="America/New_York"
      />,
    );
    const input = screen.getByLabelText(/choose a file/i, { selector: "input" });
    await chooseFile(
      input,
      [
        "customer_name,email,booking_date,tour_name,booking_id",
        "Hana Kobayashi,hana@example.com,2026-10-20,Two-tank Molasses Reef,FH-1",
        "Hana Kobayashi,hana@example.com,2026-10-23,Night dive Benwood,FH-2",
        "Sam Reed,sam@example.com,2026-11-14,Discover Scuba,FH-3",
      ].join("\n"),
    );

    await waitFor(() => {
      expect(
        screen.getByText("2 bookings are after today. Keep them in FareHarbor."),
      ).toBeInTheDocument();
    });
    const list = screen.getByRole("list", { name: /bookings are after today/i });
    expect(list).toHaveTextContent(/Oct\s23,\s2026 · Hana Kobayashi · Night dive Benwood/);
    expect(list).toHaveTextContent(/Nov\s14,\s2026 · Sam Reed · Discover Scuba/);
    expect(list).not.toHaveTextContent("Two-tank Molasses Reef");
  });

  it("says nothing when every booking is today or earlier", async () => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-10-23T03:00:00Z");
    render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
        locale="en-US"
        timeZone="America/New_York"
      />,
    );
    const input = screen.getByLabelText(/choose a file/i, { selector: "input" });
    await chooseFile(
      input,
      "customer_name,email,booking_date,tour_name\nHana,hana@example.com,2026-10-22,Reef\n",
    );
    await waitFor(() => expect(screen.getByText("Divers in file")).toBeInTheDocument());
    expect(screen.queryByText(/after today/)).not.toBeInTheDocument();
  });
});

describe("a Claude mapping that comes back after the file changed", () => {
  it("is dropped, so the preview and the posted csv are the same file", async () => {
    let answer: (value: ImportAssist) => void = () => {};
    const map = vi.fn(
      (_csv: string) =>
        new Promise<ImportAssist>((resolve) => {
          answer = resolve;
        }),
    );
    const { container } = render(
      <ImportWizard
        diversHref="/shop/blue-mantis/divers"
        intro="Upload contacts.csv"
        copy={COPY}
        locale="en-US"
        timeZone="America/New_York"
        assist={{
          map,
          words: {
            map: "Map the rest",
            mapping: "Mapping…",
            mapHint: "Claude reads a sample",
            mapNothing: "Nothing to map",
            suggested: "{field}, suggested",
            pendingCards: "Cards import for review",
          },
        }}
      />,
    );
    const input = screen.getByLabelText(/choose a file/i, { selector: "input" });
    const first = "full_name,email,Neopreno\nAna Old,ana@example.com,M\n";
    const second = "full_name,email,Neopreno\nBea New,bea@example.com,L\n";

    await chooseFile(input, first, "first.csv");
    await userEvent.click(await screen.findByRole("button", { name: "Map the rest" }));
    expect(map).toHaveBeenCalledWith(first);

    await chooseFile(input, second, "second.csv");
    await waitFor(() => expect(screen.getByText("Bea New")).toBeInTheDocument());

    answer({ headers: { Neopreno: "wetsuit_size" }, levels: {} });
    await waitFor(() => expect(screen.queryByText("Mapping…")).not.toBeInTheDocument());

    expect(screen.getByText("Bea New")).toBeInTheDocument();
    expect(screen.queryByText("Ana Old")).not.toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[name="csv"]')?.value).toBe(second);
    expect(container.querySelector('input[name="assist"]')).toBeNull();
  });
});
