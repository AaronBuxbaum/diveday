// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { RunningLate } from "./RunningLate";

vi.mock("../day-of-actions", () => ({
  clearRunningLateAction: async () => {},
  sayRunningLateAction: async () => {},
}));

afterEach(cleanup);
const t = diverTranslator("en-US");
const data = (saidAt: Date | null) =>
  ({
    runningLate: { open: true, saidAt },
    detail: {
      shop: { timezone: "America/New_York" },
      trip: { startsAt: new Date("2026-07-21T12:00:00Z") },
    },
    shop: { dockCallMinutes: 30 },
    pickupTime: null,
  }) as unknown as ReadyPageData;

describe("RunningLate", () => {
  it("offers the unsent action", () => {
    render(<RunningLate token="tok" data={data(null)} locale="en-US" t={t} />);
    const action = screen.getByRole("button", { name: t("ready.lateButton") });
    expect(action).toBeInTheDocument();
  });

  it("states the submitted late notice beside its undo", () => {
    const { container } = render(
      <RunningLate
        token="tok"
        data={data(new Date("2026-07-21T11:42:00Z"))}
        locale="en-US"
        t={t}
      />,
    );
    expect(container.querySelector("p")?.textContent).toContain("7:42");
    const undo = screen.getByRole("button", { name: t("ready.lateUndo") });
    expect(undo).toBeInTheDocument();
  });
});
