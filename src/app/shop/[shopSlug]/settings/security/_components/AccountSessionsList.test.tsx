// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AccountSessionDisplayRow, AccountSessionsList } from "./AccountSessionsList";

afterEach(cleanup);

const labels = {
  thisDevice: "This device",
  browserLine: (browser: string) => `Browser: ${browser}`,
  networkLine: (network: string) => `Network: ${network}`,
  unknownDevice: "Unknown device",
  unknownIp: "Unknown network",
  revoke: "Revoke",
  revoking: "Revoking…",
  group: (count: number) => `${count} sessions`,
  showSessions: "Show sessions",
  showAll: "Show all",
};

function row(
  id: string,
  deviceLabel: string,
  day: number,
  isCurrent = false,
): AccountSessionDisplayRow {
  return {
    id,
    deviceLabel,
    isCurrent,
    lastSeenAt: new Date(Date.UTC(2026, 9, day, 12)),
    lastSeen: `last seen Oct ${day}`,
    userAgent: `${deviceLabel} agent`,
    ipAddress: `192.0.2.${day}`,
  };
}

describe("active account sessions", () => {
  it("draws one row per device, current first, with every session's Revoke inside it", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, index) =>
        row(`chrome-${index}`, "Chrome · Linux", index + 1),
      ),
      row("phone", "Safari · iOS", 2, true),
    ];
    const { container } = render(
      <AccountSessionsList
        rows={rows}
        labels={labels}
        shopSlug="blue-mantis"
        revokeAction={vi.fn(async () => {})}
      />,
    );

    const groups = container.querySelectorAll("li.py-3");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent("Safari · iOS");
    expect(within(groups[0] as HTMLElement).getAllByText("This device").length).toBeGreaterThan(0);
    expect(groups[1]).toHaveTextContent("30 sessions");
    // Every session keeps its own Revoke, posting its own id.
    const ids = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="sessionId"]'),
    ).map((input) => input.value);
    expect(ids.sort()).toEqual(rows.map((session) => session.id).sort());
    expect(screen.getAllByRole("button", { name: "Revoke", hidden: true })).toHaveLength(31);
  });

  it("shows five devices and folds the rest behind Show all", () => {
    const devices = ["A", "B", "C", "D", "E", "F", "G"];
    const { container } = render(
      <AccountSessionsList
        rows={devices.map((name, index) => row(name, `${name} · Linux`, index + 1))}
        labels={labels}
        shopSlug="blue-mantis"
        revokeAction={vi.fn(async () => {})}
      />,
    );
    const showAll = screen.getByText("Show all");
    const folded = showAll.closest("details") as HTMLElement;
    expect(folded.querySelectorAll("li.py-3")).toHaveLength(2);
    expect(container.querySelectorAll("li.py-3")).toHaveLength(7);
    // Newest first: G and F are seen latest, so A and B are the folded two.
    expect(folded).toHaveTextContent("A · Linux");
    expect(folded).toHaveTextContent("B · Linux");
  });

  it("says each detail as one bundle sentence, falling back to the unknown words", () => {
    render(
      <AccountSessionsList
        rows={[
          row("known", "Chrome · Windows", 3),
          { ...row("unknown", "Unknown device", 4), userAgent: null, ipAddress: null },
        ]}
        labels={labels}
        shopSlug="blue-mantis"
        revokeAction={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText("Browser: Chrome · Windows agent")).toBeInTheDocument();
    expect(screen.getByText("Network: 192.0.2.3")).toBeInTheDocument();
    expect(screen.getByText("Browser: Unknown device")).toBeInTheDocument();
    expect(screen.getByText("Network: Unknown network")).toBeInTheDocument();
  });
});
