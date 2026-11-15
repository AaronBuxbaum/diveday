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
function mount(history: Parameters<typeof ComputerDives>[0]["history"] = []) {
  return render(
    <ComputerDives
      shopSlug="blue-mantis"
      personId={personId}
      personName="Priya Sharma"
      history={history}
      copy={copy}
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
