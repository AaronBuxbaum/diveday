// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetThisReadyPage } from "@/lib/ready-offline";
import { ForgetReadyCopy } from "./ForgetReadyCopy";

vi.mock("@/lib/ready-offline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ready-offline")>()),
  forgetThisReadyPage: vi.fn(async () => true),
}));

afterEach(cleanup);

/**
 * **A cancelled seat takes its saved copy with it** (issue #2979): drawn on
 * the cancelled card, however the diver reached it (the self-cancel's
 * redirect, a reload, a staff cancel opened online), and silent.
 */
describe("ForgetReadyCopy", () => {
  it("asks the worker to forget this page's copy once, and draws nothing on success", () => {
    const { container } = render(<ForgetReadyCopy failedText="Could not remove saved page." />);
    expect(forgetThisReadyPage).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });

  it("reports that the saved page may remain when the worker cannot forget it", async () => {
    vi.mocked(forgetThisReadyPage).mockResolvedValueOnce(false);
    const { findByRole } = render(
      <ForgetReadyCopy failedText="The saved page may still be on this device." />,
    );
    expect(await findByRole("status")).toHaveTextContent(
      "The saved page may still be on this device.",
    );
  });
});
