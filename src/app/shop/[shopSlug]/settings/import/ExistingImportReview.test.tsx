// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { type ExistingImportCopy, ExistingImportReview } from "./ExistingImportReview";
import { existingImportCopy } from "./existing-import-copy";
import { reviewExistingImportAction } from "./review-actions";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop/test/settings/import" }));
vi.mock("./review-actions", () => ({ reviewExistingImportAction: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const copy: ExistingImportCopy = {
  choose: "Choose files",
  chooseAnother: "Other files",
  mapping: "Map columns",
  unmapped: "Choose field",
  review: "Check outcomes",
  submit: "Import rows",
  busy: "Working",
  safety: "No reservations",
  preview: "First 60",
  row: "Row",
  outcome: "Outcome",
  correction: "Correction CSV",
  correctionFilename: "corrections.csv",
  failed: "Failed",
  stale: "Not checked",
  result: "Actual results",
  fileType: "File contains",
  sites: "Sites",
  creatures: "Guides",
  outcomes: {
    create: "New",
    update: "Matched",
    duplicate: "Repeated",
    skip: "Skipped",
    processed: "Processed",
  },
  errors: {},
  issues: { service_already_recorded: "This service is already recorded." },
  unknownIssue: "Check this row in the correction CSV, then review it again.",
  mappingRequired: "Map each column once",
  counts: { unitsCreated: "Units created" },
};
const columns = { gear: ["gear_label", "service_note"] };
function file(name: string, content: string) {
  const result = new File([content], name, { type: "text/csv" });
  Object.defineProperty(result, "text", { value: async () => content });
  return result;
}
async function pick(upload: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, upload);
  await screen.findByRole("heading", { name: upload.name });
}

describe("existing import review generations", () => {
  it("renders one valid header row with each mapped column heading", async () => {
    const { container } = render(
      <ExistingImportReview kind="gear" columns={columns} copy={copy} />,
    );
    await pick(file("headers.csv", "gear_label,service_note\nA,checked"));
    expect(container.querySelectorAll("thead tr tr")).toHaveLength(0);
    expect(container.querySelectorAll("thead > tr")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader").map((heading) => heading.textContent)).toEqual([
      "Row",
      "Outcome",
      "gear_label",
      "service_note",
    ]);
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(1);
  });
  it("requires explicit mapping of every column and resets a completed result for a new file", async () => {
    vi.mocked(reviewExistingImportAction)
      .mockResolvedValueOnce({ rows: [[{ rowNumber: 2, outcome: "create", issues: [] }]] })
      .mockResolvedValueOnce({
        completed: true,
        counts: { unitsCreated: 1 },
        rows: [[{ rowNumber: 2, outcome: "processed", issues: [] }]],
      });
    render(<ExistingImportReview kind="gear" columns={columns} copy={copy} />);
    await pick(file("first.csv", "Tag,service_note\nA,=formula()"));
    expect(screen.getByRole("button", { name: "Check outcomes" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("1. Tag"), "gear_label");
    await userEvent.click(screen.getByRole("button", { name: "Check outcomes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import rows (1)" }));
    await screen.findByText("Actual results");
    await pick(file("second.csv", "gear_label\nB"));
    expect(screen.queryByText("Actual results")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import rows (1)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check outcomes" })).toBeEnabled();
  });
  it("shows the repeated gear outcome and its evidence after reviewing the same file again", async () => {
    vi.mocked(reviewExistingImportAction)
      .mockResolvedValueOnce({ rows: [[{ rowNumber: 2, outcome: "create", issues: [] }]] })
      .mockResolvedValueOnce({
        completed: true,
        counts: { unitsCreated: 1 },
        rows: [[{ rowNumber: 2, outcome: "processed", issues: [] }]],
      })
      .mockResolvedValueOnce({
        rows: [[{ rowNumber: 2, outcome: "duplicate", issues: ["service_already_recorded"] }]],
      });
    render(<ExistingImportReview kind="gear" columns={columns} copy={copy} />);
    await pick(file("service.csv", "gear_label\nCSV-REVIEW-REG"));
    await userEvent.click(screen.getByRole("button", { name: "Check outcomes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import rows (1)" }));
    await screen.findByText("Actual results");
    await pick(file("service.csv", "gear_label\nCSV-REVIEW-REG"));
    expect(screen.queryByText("Actual results")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check outcomes" }));
    const row = await screen.findByRole("row", { name: /CSV-REVIEW-REG/ });
    const outcome = within(row).getAllByRole("cell")[1];
    // Playwright's exact text locator includes the issue paragraph in this cell.
    expect(outcome.textContent).toBe("RepeatedThis service is already recorded.");
    expect(outcome).toHaveTextContent("Repeated");
    expect(outcome).not.toHaveTextContent("service_already_recorded");
  });
  it("ignores a late review after selecting a different file", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof reviewExistingImportAction>>) => void;
    vi.mocked(reviewExistingImportAction).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<ExistingImportReview kind="gear" columns={columns} copy={copy} />);
    await pick(file("old.csv", "gear_label\nA"));
    await userEvent.click(screen.getByRole("button", { name: "Check outcomes" }));
    await pick(file("new.csv", "gear_label\nB"));
    resolve({ rows: [[{ rowNumber: 2, outcome: "create", issues: [] }]] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check outcomes" })).toBeEnabled(),
    );
    expect(screen.queryByRole("button", { name: "Import rows (1)" })).toBeNull();
    expect(screen.getByText("B")).toBeVisible();
  });
  it("exports only rows needing attention and makes the full preview keyboard reachable", async () => {
    vi.mocked(reviewExistingImportAction).mockResolvedValue({
      rows: [[{ rowNumber: 2, outcome: "skip", issues: ["bad_date"] }]],
    });
    render(<ExistingImportReview kind="gear" columns={columns} copy={copy} />);
    await pick(file("errors.csv", "gear_label,service_note\n=cmd(),bad"));
    await userEvent.click(screen.getByRole("button", { name: "Check outcomes" }));
    const link = await screen.findByRole("link", { name: "Correction CSV" });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain("'=cmd()");
    expect(screen.getByRole("region", { name: "First 60: errors.csv" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
});

for (const [locale, guidance] of [
  ["en-US", "Enter the service date as YYYY-MM-DD."],
  ["es-ES", "Ingresa la fecha de servicio como AAAA-MM-DD."],
] as const) {
  it(`translates review diagnostics in ${locale} while retaining correction evidence`, async () => {
    vi.mocked(reviewExistingImportAction).mockResolvedValue({
      rows: [
        [
          {
            rowNumber: 2,
            outcome: "skip",
            issues: ["invalid_service_date", "unexpected_private_detail", "constructor", ""],
          },
        ],
      ],
    });
    const words = existingImportCopy(staffTranslator(locale), "gear");
    render(<ExistingImportReview kind="gear" columns={columns} copy={words} />);
    await pick(file("dates.csv", "gear_label,service_note\nA,bad"));
    await userEvent.click(screen.getByRole("button", { name: words.review }));
    expect(await screen.findByText((text) => text.includes(guidance))).toBeVisible();
    const row = screen.getByRole("row", { name: /A bad/ });
    expect(row).toHaveTextContent(words.unknownIssue);
    expect(row).not.toHaveTextContent("invalid_service_date");
    expect(row).not.toHaveTextContent("unexpected_private_detail");
    const csv = decodeURIComponent(
      screen.getByRole("link", { name: words.correction }).getAttribute("href") ?? "",
    );
    expect(csv).toContain("invalid_service_date");
    expect(csv).toContain("unexpected_private_detail");
    expect(csv).toContain("A,bad");
  });
}

for (const locale of ["en-US", "es-ES"] as const) {
  it(`renders guidance for every supported diagnostic in ${locale}`, async () => {
    const words = existingImportCopy(staffTranslator(locale), "sites");
    const issues = Object.keys(words.issues);
    vi.mocked(reviewExistingImportAction).mockResolvedValue({
      rows: [[{ rowNumber: 2, outcome: "skip", issues }]],
    });
    render(<ExistingImportReview kind="gear" columns={columns} copy={words} />);
    await pick(file("diagnostics.csv", "gear_label\nReview item"));
    await userEvent.click(screen.getByRole("button", { name: words.review }));
    const row = await screen.findByRole("row", { name: /Review item/ });
    await waitFor(() => expect(row).toHaveTextContent(words.issues.invalid_service_date));
    for (const [code, guidance] of Object.entries(words.issues)) {
      expect(guidance).not.toBe(code);
      expect(guidance.trim()).not.toBe("");
      expect(row).toHaveTextContent(guidance);
      expect(row).not.toHaveTextContent(code);
    }
    expect(row).not.toHaveTextContent(words.unknownIssue);
  });
}
