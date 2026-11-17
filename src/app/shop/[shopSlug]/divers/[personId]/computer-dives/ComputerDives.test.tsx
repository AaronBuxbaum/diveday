// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffMessagesFor } from "@/i18n/staff-messages";
import type { ParsedComputerDive } from "@/lib/computer-import";
import { ComputerDives } from "./ComputerDives";

const actions = vi.hoisted(() => ({
  previewAction: vi.fn(),
  commitAction: vi.fn(),
  changeAction: vi.fn(),
  exportAction: vi.fn(),
  exportCsvAction: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./computer-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
afterEach(cleanup);
const copy = staffMessagesFor("en-US").computerDives;
const record: ParsedComputerDive = {
  sourceFormat: "csv",
  sourceId: "fixture-1",
  device: "Fixture Computer",
  localStart: "2031-10-14T23:40:00",
  startInstant: null,
  offsetMinutes: null,
  durationSeconds: 1800,
  maxDepthMeters: 18,
  samples: [],
  gases: [],
  tanks: [],
  sourceUnits: { depth: "m", temperature: null, pressure: null },
  warnings: ["timezone_unknown", "profile_absent"],
};
const preview = {
  personName: "Priya Sharma",
  files: [{ name: "computer.csv", error: null }],
  dives: [{ key: "fixture-key", fingerprint: "fixture-fingerprint", record, duplicate: null }],
};
const personId = "0a3e23c8-b66c-46a1-959d-cce58a546093";
function mount(history: Parameters<typeof ComputerDives>[0]["history"] = [], words = copy) {
  return render(
    <ComputerDives
      shopSlug="blue-mantis"
      personId={personId}
      personName="Priya Sharma"
      history={history}
      copy={words}
    />,
  );
}
async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText(copy.files, { exact: true }),
    new File(["fixture"], "computer.csv", { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: copy.preview }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: copy.previewHeading })).toHaveFocus(),
  );
  await screen.findByRole("button", { name: copy.commit });
}
beforeEach(() => {
  vi.clearAllMocks();
  actions.previewAction.mockResolvedValue({ ok: true, value: preview });
  actions.commitAction.mockResolvedValue({ ok: true, value: { imported: 1, skipped: 0 } });
  actions.changeAction.mockResolvedValue({ ok: true });
});
describe("computer file review", () => {
  it("requires per-record timezone review and a named target, then cancellation clears files and returns focus", async () => {
    const user = userEvent.setup();
    mount();
    await openPreview(user);
    expect(actions.commitAction).not.toHaveBeenCalled();
    const commit = screen.getByRole("button", { name: copy.commit });
    expect(commit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: copy.confirmZone }));
    expect(commit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.confirmTarget) }));
    expect(commit).toBeEnabled();
    await user.type(screen.getByLabelText(copy.offset, { exact: true }), "-300");
    expect(screen.getByRole("checkbox", { name: copy.confirmZone })).not.toBeChecked();
    expect(commit).toBeDisabled();
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    expect(screen.getByLabelText(copy.files, { exact: true })).toHaveFocus();
    expect(screen.getByLabelText(copy.files, { exact: true })).toHaveValue("");
    expect(actions.commitAction).not.toHaveBeenCalled();
  });
  it("blocks repeated clicks while pending and retries with the same request key and original files", async () => {
    const user = userEvent.setup();
    mount();
    await openPreview(user);
    await user.click(screen.getByRole("checkbox", { name: copy.confirmZone }));
    await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.confirmTarget) }));
    let complete: (value: unknown) => void = () => {};
    actions.commitAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await user.dblClick(screen.getByRole("button", { name: copy.commit }));
    expect(actions.commitAction).toHaveBeenCalledTimes(1);
    complete({ ok: true, value: { imported: 1, skipped: 0 } });
    await waitFor(() => expect(screen.getByRole("button", { name: copy.retry })).toBeEnabled());
    expect(screen.getByText(copy.done).parentElement?.querySelectorAll("dt")).toHaveLength(3);
    expect(screen.getByRole("button", { name: copy.importMore })).toBeEnabled();
    expect(screen.queryByRole("button", { name: copy.cancel })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.retry }));
    expect(actions.commitAction).toHaveBeenCalledTimes(2);
    const first = actions.commitAction.mock.calls[0][2] as FormData;
    const retry = actions.commitAction.mock.calls[1][2] as FormData;
    expect(retry.get("requestKey")).toBe(first.get("requestKey"));
    expect(first.get("confirmedPersonId")).toBe(personId);
    expect(first.getAll("selected")).toEqual(["fixture-key"]);
    expect(first.get("timeOffsets")).toBe('{"fixture-key":null}');
    expect((first.get("files") as File).name).toBe("computer.csv");
  });
  it("keeps exact duplicates disabled while presenting possible duplicates for selection", async () => {
    actions.previewAction.mockResolvedValue({
      ok: true,
      value: {
        ...preview,
        dives: [
          { ...preview.dives[0], duplicate: "exact" },
          {
            ...preview.dives[0],
            key: "possible-key",
            record: { ...record, device: "Second Computer" },
            duplicate: "possible",
          },
        ],
      },
    });
    const user = userEvent.setup();
    mount();
    await openPreview(user);
    expect(
      screen.getByRole("checkbox", { name: new RegExp(`${copy.selected}.*Fixture Computer`) }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: new RegExp(`${copy.selected}.*Second Computer`) }),
    ).not.toBeChecked();
    expect(screen.getByText(copy.exact, { exact: true })).toBeVisible();
    expect(screen.getByText(copy.possible, { exact: true })).toBeVisible();
  });
  it("shows the imported profile, gases, source units and annotation controls with reversible deletion", async () => {
    const user = userEvent.setup();
    mount([
      {
        id: personId,
        record: {
          ...record,
          samples: [
            { seconds: 0, depthMeters: 0 },
            { seconds: 900, depthMeters: 18 },
            { seconds: 1800, depthMeters: 0 },
          ],
          gases: [{ id: "ean32", oxygenFraction: 0.32, heliumFraction: null }],
        },
        annotation: "Clock checked",
        deletedAt: null,
      },
    ]);
    await user.click(screen.getByText(`${record.localStart} · Fixture Computer`, { exact: true }));
    expect(screen.getByRole("img", { name: copy.profile })).toBeVisible();
    expect(screen.getByText("0.32", { exact: true })).toBeVisible();
    expect(screen.getByText(copy.warningCodes.timezone_unknown, { exact: true })).toBeVisible();
    await user.clear(screen.getByLabelText(copy.notes, { exact: true }));
    await user.type(
      screen.getByLabelText(copy.notes, { exact: true }),
      "Original computer retained",
    );
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(actions.changeAction).toHaveBeenCalledWith(
      "blue-mantis",
      personId,
      personId,
      "note",
      "Original computer retained",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: copy.delete })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: copy.delete }));
    expect(actions.changeAction).toHaveBeenCalledWith(
      "blue-mantis",
      personId,
      personId,
      "delete",
      "",
    );
  });
});

it("withholds the export control when the staff member lacks export permission", () => {
  mount();
  expect(screen.queryByRole("button", { name: copy.export })).not.toBeInTheDocument();
});

it("gives an empty history its own section heading", () => {
  mount();
  expect(screen.getByRole("heading", { name: copy.empty })).toBeVisible();
});

it("shows the FIT UTC instant and unknown local clock without offering to reinterpret it", async () => {
  actions.previewAction.mockResolvedValue({
    ok: true,
    value: {
      ...preview,
      dives: [
        {
          ...preview.dives[0],
          record: {
            ...record,
            sourceFormat: "fit",
            localStart: null,
            startInstant: "2026-07-21T23:40:00.000Z",
            warnings: ["local_time_unknown"],
          },
        },
      ],
    },
  });
  const user = userEvent.setup();
  mount();
  await openPreview(user);
  expect(screen.getByRole("checkbox", { name: /2026-07-21T23:40:00.000Z/ })).toBeVisible();
  expect(screen.queryByLabelText(copy.offset, { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: copy.confirmZone }));
  await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.confirmTarget) }));
  await user.click(screen.getByRole("button", { name: copy.commit }));
  expect((actions.commitAction.mock.calls[0][2] as FormData).get("timeOffsets")).toBe(
    '{"fixture-key":null}',
  );
});

it.each(["en-US", "es-ES"] as const)(
  "shows SSI transfer guidance without importing or connecting in %s",
  async (locale) => {
    const words = staffMessagesFor(locale).computerDives;
    const user = userEvent.setup();
    mount([], words);
    await user.selectOptions(screen.getByLabelText(words.provider), "ssi");
    expect(screen.getByText(words.providers.ssi.hint)).toBeVisible();
    expect(screen.getByRole("link", { name: words.providerGuide })).toHaveAttribute(
      "href",
      "https://www.divessi.com/en/blog/blog/blog/scubapro-logtrak-myssi-app-integration-10251.html",
    );
    expect(actions.previewAction).not.toHaveBeenCalled();
    expect(actions.commitAction).not.toHaveBeenCalled();
    expect(actions.changeAction).not.toHaveBeenCalled();
  },
);

it("labels online sources beta and preserves the chosen manual source through review and retries", async () => {
  const user = userEvent.setup();
  mount();
  await user.selectOptions(screen.getByLabelText(copy.provider), "padi");
  expect(screen.getByText(copy.providers.padi.hint)).toBeVisible();
  expect(screen.getByText(copy.betaHint)).toBeVisible();
  expect(screen.getByRole("link", { name: copy.providerGuide })).toHaveAttribute(
    "href",
    "https://www.padi.com/scuba-diving-mobile-apps",
  );
  await openPreview(user);
  expect(screen.getByLabelText(copy.provider)).toBeDisabled();
  expect(
    JSON.parse((actions.previewAction.mock.calls[0][2] as FormData).get("importOptions") as string),
  ).toEqual({ provider: "padi" });
  await user.click(screen.getByRole("checkbox", { name: copy.confirmZone }));
  await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.confirmTarget) }));
  await user.click(screen.getByRole("button", { name: copy.commit }));
  await screen.findByRole("button", { name: copy.retry });
  await user.click(screen.getByRole("button", { name: copy.retry }));
  expect((actions.commitAction.mock.calls[1][2] as FormData).get("importOptions")).toBe(
    '{"provider":"padi"}',
  );
  await user.click(screen.getByRole("button", { name: copy.importMore }));
  expect(screen.getByLabelText(copy.provider)).toHaveValue("generic");
  expect(screen.getByRole("checkbox", { name: copy.mapCsv })).not.toBeChecked();
});

it("shows a date-only entry with unknown time and no timezone override", async () => {
  actions.previewAction.mockResolvedValue({
    ok: true,
    value: {
      ...preview,
      dives: [
        {
          ...preview.dives[0],
          record: {
            ...record,
            localStart: null,
            localDate: "2031-10-14",
            warnings: ["date_only", "timezone_unknown"],
            importSource: { provider: "ssi", beta: true },
            archiveEntry: "logs/personal.csv",
            archiveIgnoredEntries: 2,
          },
        },
      ],
    },
  });
  const user = userEvent.setup();
  mount();
  await openPreview(user);
  expect(screen.getByRole("checkbox", { name: /2031-10-14/ })).toBeVisible();
  expect(screen.getAllByText(copy.warningCodes.date_only)[0].firstChild).not.toBeNull();
  expect(
    screen.queryByText(copy.warningCodes.timezone_unknown, { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(copy.offset, { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByText("logs/personal.csv")[0]).toBeVisible();
  expect(screen.getAllByText(`${copy.providers.ssi.label} · ${copy.beta}`)[0]).toBeVisible();
});

it("withholds both exports without permission and downloads a summary CSV when authorized", async () => {
  const user = userEvent.setup();
  const initial = mount();
  expect(screen.queryByRole("button", { name: copy.exportCsv })).not.toBeInTheDocument();
  initial.unmount();
  render(
    <ComputerDives
      shopSlug="blue-mantis"
      personId={personId}
      personName="Priya Sharma"
      history={[
        {
          id: "deleted-record",
          record,
          annotation: "",
          deletedAt: new Date("2031-10-14T12:00:00Z"),
        },
      ]}
      copy={copy}
      canExport
    />,
  );
  const createObjectURL = vi.fn(() => "blob:summary");
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  actions.exportCsvAction.mockResolvedValue({
    ok: true,
    value: "date,duration_seconds\n2031-10-14,1800\n",
  });
  await user.click(screen.getByRole("button", { name: copy.exportCsv }));
  expect(actions.exportCsvAction).toHaveBeenCalledWith("blue-mantis", personId);
  expect(createObjectURL).toHaveBeenCalled();
  click.mockRestore();
  vi.unstubAllGlobals();
});

it("requires explicit CSV dates and units, escapes headers, and freezes the exact mapping for commit", async () => {
  const user = userEvent.setup();
  const malicious = "<img src=x onerror=alert(1)>";
  mount();
  await user.selectOptions(screen.getByLabelText(copy.provider), "ssi");
  await user.upload(
    screen.getByLabelText(copy.files, { exact: true }),
    new File([`Date,Minutes,Feet,${malicious}\n14/10/2031,30,60,own entry\n`], "spreadsheet.csv", {
      type: "text/csv",
    }),
  );
  await user.click(screen.getByRole("checkbox", { name: copy.mapCsv }));
  await waitFor(() =>
    expect(screen.getByLabelText(copy.mapping.date, { exact: true })).toBeEnabled(),
  );
  const previewButton = screen.getByRole("button", { name: copy.preview });
  expect(previewButton).toBeDisabled();
  expect(screen.getByLabelText(copy.mapping.dateFormat)).toHaveValue("");
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getAllByRole("option", { name: malicious })).toHaveLength(7);
  await user.selectOptions(screen.getByLabelText(copy.mapping.date, { exact: true }), "Date");
  await user.selectOptions(screen.getByLabelText(copy.mapping.dateFormat), "dmy");
  await user.selectOptions(
    screen.getByLabelText(copy.mapping.duration, { exact: true }),
    "Minutes",
  );
  await user.selectOptions(screen.getByLabelText(copy.mapping.maxDepth, { exact: true }), "Feet");
  expect(screen.getByLabelText(copy.mapping.durationUnit)).toHaveValue("");
  expect(screen.getByLabelText(copy.mapping.depthUnit)).toHaveValue("");
  expect(previewButton).toBeDisabled();
  await user.selectOptions(screen.getByLabelText(copy.mapping.durationUnit), "minutes");
  await user.selectOptions(screen.getByLabelText(copy.mapping.depthUnit), "ft");
  expect(previewButton).toBeEnabled();
  await user.click(previewButton);
  await screen.findByRole("heading", { name: copy.previewHeading });
  const mapping = {
    provider: "ssi",
    csvMapping: {
      columns: { date: "Date", duration: "Minutes", maxDepth: "Feet" },
      dateFormat: "dmy",
      durationUnit: "minutes",
      depthUnit: "ft",
    },
  };
  expect(
    JSON.parse((actions.previewAction.mock.calls[0][2] as FormData).get("importOptions") as string),
  ).toEqual(mapping);
  expect(screen.getByLabelText(copy.mapping.depthUnit)).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: copy.mapCsv })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: copy.confirmZone }));
  await user.click(screen.getByRole("checkbox", { name: new RegExp(copy.confirmTarget) }));
  await user.click(screen.getByRole("button", { name: copy.commit }));
  expect(
    JSON.parse((actions.commitAction.mock.calls[0][2] as FormData).get("importOptions") as string),
  ).toEqual(mapping);
  await screen.findByRole("button", { name: copy.retry });
  await user.click(screen.getByRole("button", { name: copy.importMore }));
  expect(screen.getByRole("checkbox", { name: copy.mapCsv })).not.toBeChecked();
  expect(screen.getByLabelText(copy.files, { exact: true })).toHaveFocus();
});

it("clears incompatible mappings when files change and prevents duplicate columns", async () => {
  const user = userEvent.setup();
  mount();
  const files = screen.getByLabelText(copy.files, { exact: true });
  await user.upload(files, new File(["Date,Depth\n2031-10-14,10\n"], "first.csv"));
  await user.click(screen.getByRole("checkbox", { name: copy.mapCsv }));
  await waitFor(() =>
    expect(screen.getByLabelText(copy.mapping.date, { exact: true })).toBeEnabled(),
  );
  await user.selectOptions(screen.getByLabelText(copy.mapping.date, { exact: true }), "Date");
  await user.selectOptions(screen.getByLabelText(copy.mapping.dateFormat), "iso");
  await user.selectOptions(screen.getByLabelText(copy.mapping.device, { exact: true }), "Date");
  expect(screen.getByRole("button", { name: copy.preview })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText(copy.mapping.device, { exact: true }), "");
  expect(screen.getByRole("button", { name: copy.preview })).toBeEnabled();
  await user.upload(files, new File(["Another date\n2031-10-14\n"], "second.csv"));
  await waitFor(() =>
    expect(screen.getAllByRole("option", { name: "Another date" })).toHaveLength(7),
  );
  expect(screen.getByLabelText(copy.mapping.date, { exact: true })).toHaveValue("");
  expect(screen.getByLabelText(copy.mapping.dateFormat)).toHaveValue("");
  expect(screen.getByRole("button", { name: copy.preview })).toBeDisabled();
});

it("guards repeated preview requests and displays an export refusal without creating a download", async () => {
  const user = userEvent.setup();
  render(
    <ComputerDives
      shopSlug="blue-mantis"
      personId={personId}
      personName="Priya Sharma"
      history={[
        {
          id: "deleted-record",
          record,
          annotation: "",
          deletedAt: new Date("2031-10-14T12:00:00Z"),
        },
      ]}
      copy={copy}
      canExport
    />,
  );
  let finish: (value: unknown) => void = () => {};
  actions.previewAction.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.upload(
    screen.getByLabelText(copy.files, { exact: true }),
    new File(["fixture"], "computer.csv"),
  );
  await user.dblClick(screen.getByRole("button", { name: copy.preview }));
  expect(actions.previewAction).toHaveBeenCalledTimes(1);
  finish({ ok: true, value: preview });
  await screen.findByRole("heading", { name: copy.previewHeading });
  actions.exportCsvAction.mockResolvedValue({ ok: false });
  await waitFor(() => expect(screen.getByRole("button", { name: copy.exportCsv })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: copy.exportCsv }));
  expect(await screen.findByText(copy.error)).toBeVisible();
});

it("shows only the empty state until there is history to export", () => {
  render(
    <ComputerDives
      shopSlug="blue-mantis"
      personId={personId}
      personName="Priya Sharma"
      history={[]}
      copy={copy}
      canExport
    />,
  );
  expect(screen.getByRole("heading", { name: copy.empty })).toBeVisible();
  expect(screen.queryByRole("button", { name: copy.export })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.exportCsv })).not.toBeInTheDocument();
  expect(screen.queryByText(copy.exportCsvHint)).not.toBeInTheDocument();
});
