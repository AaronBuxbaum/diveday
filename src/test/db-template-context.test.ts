import { expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";

const ensure = vi.hoisted(() => vi.fn());
const fingerprint = vi.hoisted(() => vi.fn());
vi.mock("./db-template-inputs", () => ({ inputsFingerprint: fingerprint }));
vi.mock("./db-template", () => ({ ensureTestDbTemplate: ensure }));

it("publishes a validated initial generation and rehashes watch edits without stale seed rebuilds", async () => {
  const { default: setup } = await import("./global-setup");
  const provide = vi.fn();
  const onTestsRerun = vi.fn();
  ensure.mockResolvedValueOnce("first");
  await setup({ provide, onTestsRerun } as unknown as TestProject);
  expect(provide).toHaveBeenLastCalledWith("divedayTemplateGeneration", "first");
  expect(onTestsRerun).toHaveBeenCalledOnce();
  let finish!: (identity: string) => void;
  fingerprint.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const rerun = onTestsRerun.mock.calls[0][0]();
  expect(provide).toHaveBeenCalledTimes(1);
  finish("changed-source");
  await rerun;
  expect(provide).toHaveBeenLastCalledWith("divedayTemplateGeneration", "changed-source");
  const failure = new Error("fingerprint failed");
  fingerprint.mockRejectedValueOnce(failure);
  await expect(onTestsRerun.mock.calls[0][0]()).rejects.toBe(failure);
  expect(provide).toHaveBeenCalledTimes(2);
  expect(ensure).toHaveBeenCalledOnce();
});
