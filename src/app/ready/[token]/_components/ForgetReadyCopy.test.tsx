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
  it("asks the worker to forget this page's copy once, and draws nothing", () => {
    const { container } = render(<ForgetReadyCopy />);
    expect(forgetThisReadyPage).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });
});
