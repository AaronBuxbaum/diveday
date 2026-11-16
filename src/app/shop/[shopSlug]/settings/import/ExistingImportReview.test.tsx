// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ExistingImportCopy, ExistingImportReview } from "./ExistingImportReview";
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
