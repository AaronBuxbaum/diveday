import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not_found");
  }),
}));
vi.mock("@/features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/features/after-the-dive/computer-dives", () => ({
  annotateComputerDive: vi.fn(),
  commitComputerFiles: vi.fn(),
  deleteComputerDive: vi.fn(),
  exportComputerDiveSummaryCsv: vi.fn(),
  exportComputerDives: vi.fn(),
  previewComputerFiles: vi.fn(),
  restoreComputerDive: vi.fn(),
}));
const { requireShopSurface } = await import("@/features/accounts/session");
const { previewComputerFiles, commitComputerFiles, exportComputerDiveSummaryCsv } = await import(
  "@/features/after-the-dive/computer-dives"
);
const { previewAction, commitAction, exportCsvAction } = await import("./computer-actions");
const personId = "11111111-1111-4111-8111-111111111111";
const db = { handle: "session db" };
const scope = { shopId: "session-shop", actorPersonId: "session-person", personId };
function form(options?: string | File) {
  const data = new FormData();
  data.append("files", new File(["date\n2026-11-01\n"], "log.csv"));
  data.set("shopId", "forged-shop");
  data.set("actorPersonId", "forged-person");
  if (options !== undefined) data.set("importOptions", options);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireShopSurface).mockResolvedValue({
    db,
    session: { user: { shopId: scope.shopId, personId: scope.actorPersonId } },
    shop: { computerDivesEnabled: true },
  } as never);
});
describe("computer-import action boundary", () => {
  it("derives scope from the live session while forwarding source choices for store validation", async () => {
    const options = {
      provider: "padi",
      csvMapping: {
        columns: { date: "date" },
        dateFormat: "iso",
        durationUnit: "seconds",
        depthUnit: "m",
      },
    };
    vi.mocked(previewComputerFiles).mockResolvedValue({
      personName: "Target diver",
      files: [],
      dives: [],
    });
    expect((await previewAction("blue-mantis", personId, form(JSON.stringify(options)))).ok).toBe(
      true,
    );
    expect(requireShopSurface).toHaveBeenCalledWith("blue-mantis");
    expect(previewComputerFiles).toHaveBeenCalledWith(
      db,
      scope,
      [expect.objectContaining({ name: "log.csv", bytes: expect.any(Uint8Array) })],
      options,
    );
  });
  it.each(["{", "x".repeat(8193), new File(["{}"], "options.json")])(
    "rejects malformed or oversized serialized options before preview: %s",
    async (options) => {
      expect(await previewAction("blue-mantis", personId, form(options))).toEqual({ ok: false });
      expect(previewComputerFiles).not.toHaveBeenCalled();
    },
  );
  it("replays the same options and confirmation with a commit request, under session scope", async () => {
    const data = form('{"provider":"ssi"}');
    data.set("selected", "file-row");
    data.set("requestKey", "retry-key");
    data.set("confirmedPersonId", personId);
    data.set("timeOffsets", '{"file-row":null}');
    vi.mocked(commitComputerFiles).mockResolvedValue({ imported: 1, skipped: 0 });
    expect(await commitAction("blue-mantis", personId, data)).toEqual({
      ok: true,
      value: { imported: 1, skipped: 0 },
    });
    expect(commitComputerFiles).toHaveBeenCalledWith(
      db,
      scope,
      expect.objectContaining({
        options: { provider: "ssi" },
        selectedKeys: ["file-row"],
        requestKey: "retry-key",
        confirmedPersonId: personId,
        timeOffsets: { "file-row": null },
      }),
    );
  });
  it("never calls preview or export after the live session gate refuses", async () => {
    vi.mocked(requireShopSurface).mockRejectedValue(new Error("not_authorized"));
    await expect(previewAction("blue-mantis", personId, form())).rejects.toThrow("not_authorized");
    await expect(exportCsvAction("blue-mantis", personId)).rejects.toThrow("not_authorized");
    expect(previewComputerFiles).not.toHaveBeenCalled();
    expect(exportComputerDiveSummaryCsv).not.toHaveBeenCalled();
  });
  it("exports only through the scoped live store and returns a refusal without data", async () => {
    vi.mocked(exportComputerDiveSummaryCsv).mockResolvedValue("header\r\n");
    expect(await exportCsvAction("blue-mantis", personId)).toEqual({
      ok: true,
      value: "header\r\n",
    });
    expect(exportComputerDiveSummaryCsv).toHaveBeenCalledWith(db, scope);
    vi.mocked(exportComputerDiveSummaryCsv).mockRejectedValue(new Error("not_authorized"));
    expect(await exportCsvAction("blue-mantis", personId)).toEqual({ ok: false });
  });
});
